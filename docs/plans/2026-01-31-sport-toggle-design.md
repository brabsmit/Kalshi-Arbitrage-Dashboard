# Sport Toggle Design

## Overview

Add the ability to toggle individual sports on/off, both via `config.toml` defaults and via runtime TUI hotkeys. Toggled-off sports stop all data fetching (odds API, score feeds) to conserve API quota. The config file is persisted on every toggle so the next launch remembers the user's choices.

## Configuration

### New `[sports]` section in config.toml

Replaces the `sports = [...]` array under `[odds_feed]`:

```toml
[sports]
basketball = true
american-football = true
baseball = false
ice-hockey = true
college-basketball = true
college-basketball-womens = false
soccer-epl = false
mma = false
```

The `sports` key is removed from `[odds_feed]`. Each sport is a boolean flag. Missing keys default to `false`.

### Config parsing

Add a new `SportsConfig` struct:

```rust
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SportsConfig {
    #[serde(default)]
    pub basketball: bool,
    #[serde(default)]
    pub american_football: bool,  // serde alias "american-football"
    #[serde(default)]
    pub baseball: bool,
    #[serde(default)]
    pub ice_hockey: bool,         // serde alias "ice-hockey"
    #[serde(default)]
    pub college_basketball: bool, // serde alias "college-basketball"
    #[serde(default)]
    pub college_basketball_womens: bool, // serde alias "college-basketball-womens"
    #[serde(default)]
    pub soccer_epl: bool,         // serde alias "soccer-epl"
    #[serde(default)]
    pub mma: bool,
}
```

Add `Serialize` derive to the top-level `Config` struct and all sub-structs so the config can be written back to disk.

Add `pub sports: SportsConfig` to `Config`. The `OddsFeedConfig.sports` field is removed.

## Canonical Sport Registry

A single `SPORT_REGISTRY` constant replaces the scattered `sport_series` vec and config list:

```rust
pub struct SportDef {
    pub key: &'static str,      // "basketball" - config key and odds API sport name
    pub series: &'static str,   // "KXNBAGAME" - Kalshi series ticker prefix
    pub label: &'static str,    // "NBA" - short TUI label
    pub hotkey: char,           // '1' - TUI toggle key
}

pub const SPORT_REGISTRY: &[SportDef] = &[
    SportDef { key: "basketball",               series: "KXNBAGAME",     label: "NBA",   hotkey: '1' },
    SportDef { key: "american-football",         series: "KXNFLGAME",    label: "NFL",   hotkey: '2' },
    SportDef { key: "baseball",                  series: "KXMLBGAME",    label: "MLB",   hotkey: '3' },
    SportDef { key: "ice-hockey",                series: "KXNHLGAME",    label: "NHL",   hotkey: '4' },
    SportDef { key: "college-basketball",        series: "KXNCAAMBGAME", label: "NCAAM", hotkey: '5' },
    SportDef { key: "college-basketball-womens", series: "KXNCAAWBGAME", label: "NCAAW", hotkey: '6' },
    SportDef { key: "soccer-epl",               series: "KXEPLGAME",    label: "EPL",   hotkey: '7' },
    SportDef { key: "mma",                       series: "KXUFCFIGHT",   label: "UFC",   hotkey: '8' },
];
```

This is the single source of truth. The `sport_series` vec in `main.rs` is replaced by iteration over `SPORT_REGISTRY`.

## Runtime Toggle State

### Shared state

```rust
pub struct EnabledSports {
    map: HashMap<String, bool>,
    config_path: PathBuf,
}
```

Wrapped in `Arc<Mutex<EnabledSports>>` and shared between the main loop and TUI.

Methods:
- `from_config(config: &SportsConfig, path: PathBuf) -> Self` - Initialize from parsed config
- `is_enabled(&self, sport_key: &str) -> bool` - Check if a sport is active
- `toggle(&mut self, sport_key: &str)` - Flip the boolean and persist to disk
- `persist(&self)` - Write current state back to `config.toml`

### Persistence

On every toggle, the `persist()` method:
1. Reads the current `config.toml` from disk
2. Parses it as a `toml::Value` (preserving all other sections)
3. Updates only the `[sports]` table values
4. Writes back to disk

This approach preserves comments and formatting in other sections as much as `toml` serialization allows. Using `toml::Value` for the round-trip rather than re-serializing the full `Config` struct avoids clobbering unrelated sections or reordering keys.

## Main Loop Integration

The main loop checks `enabled_sports.is_enabled(sport)` at three gating points:

1. **Odds API polling** (~line 1265): Skip the per-sport fetch entirely
2. **NBA score feed** (~line 1137): Skip NBA polling if `basketball` is disabled
3. **College score feed** (~line 1195): Skip men's if `college-basketball` disabled, skip women's if `college-basketball-womens` disabled
4. **Diagnostic-only fetch** (~line 1397): Skip diagnostic polls for disabled sports

When a sport is toggled off:
- No API calls are made for that sport
- Existing rows for that sport are not produced on the next evaluation tick, so they disappear naturally
- No special cleanup of velocity trackers, book pressure, or caches needed - they go stale harmlessly

When a sport is toggled back on:
- The next poll cycle (within `live_poll_interval_s`) fetches fresh data
- Brief delay of up to ~20s before markets appear (acceptable tradeoff for quota savings)

## TUI Integration

### Hotkey handling

In the TUI event loop, keys `1`-`8` trigger toggles. On keypress:
1. Look up the sport by hotkey in `SPORT_REGISTRY`
2. Lock `enabled_sports` mutex, call `toggle(sport_key)`
3. The legend updates on the next 200ms render tick

These hotkeys work from any view (default, market focus, diagnostic, etc.) except when in a text input context (if any exist in the future).

### Status bar legend

A new persistent line in the footer area:

```
[1]NBA [2]NFL [3]MLB [4]NHL [5]NCAAM [6]NCAAW [7]EPL [8]UFC
```

- **Enabled sports**: Rendered in the app's highlight color (Green/Cyan)
- **Disabled sports**: Rendered in `DarkGray`
- Placed below the existing keybinding hints line

Rendering logic iterates over `SPORT_REGISTRY`, checks `enabled_sports.is_enabled()` for each, and applies the appropriate style.

### AppState changes

Add `enabled_sports: Arc<Mutex<EnabledSports>>` to `AppState`. The TUI render function reads this to color the legend. The TUI event handler writes to it on hotkey press.

## Migration from Current Config

The `sports` array under `[odds_feed]` is removed. On first load, if `[sports]` section is missing but `[odds_feed].sports` exists, the loader could auto-migrate by converting the array to the new `[sports]` section. However, since this is a development tool with a single user, simply updating `config.toml` manually is acceptable.

## Files Changed

| File | Change |
|------|--------|
| `config.toml` | New `[sports]` section, remove `sports` from `[odds_feed]` |
| `src/config.rs` | Add `SportsConfig` struct, add `Serialize` derives, remove `sports` from `OddsFeedConfig` |
| `src/main.rs` | Replace `sport_series` vec with `SPORT_REGISTRY`, add `EnabledSports` shared state, gate all fetch/eval paths |
| `src/tui/state.rs` | Add `enabled_sports: Arc<Mutex<EnabledSports>>` to `AppState` |
| `src/tui/render.rs` | Add sport legend line to footer, style by enabled/disabled |
| `src/tui/mod.rs` | Handle `1`-`8` hotkeys in event loop, toggle sports |

## Adding a New Sport in the Future

1. Add one entry to `SPORT_REGISTRY`
2. Add one field to `SportsConfig`
3. Add one line to `config.toml`
4. If it has a score feed, add the feed URL config and wire up the polling (separate from this feature)
