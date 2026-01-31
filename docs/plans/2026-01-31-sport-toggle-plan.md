# Sport Toggle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow toggling individual sports on/off via config and runtime TUI hotkeys, controlling which markets appear and which data is fetched.

**Architecture:** A shared `EnabledSports` struct (behind `Arc<Mutex>`) holds per-sport booleans initialized from a new `[sports]` config section. The TUI event loop handles hotkey `1`-`8` to toggle, and the main evaluation loop checks enabled state before fetching/evaluating. Config is persisted to disk on every toggle.

**Tech Stack:** Rust, serde (Deserialize + Serialize), toml crate (read/write), ratatui (TUI rendering), Arc<Mutex> for shared state.

---

### Task 1: Update config.toml and SportsConfig struct

**Files:**
- Modify: `kalshi-arb/config.toml:19-26`
- Modify: `kalshi-arb/src/config.rs:8-62`

**Step 1: Update config.toml**

Replace the `sports` line under `[odds_feed]` and add a new `[sports]` section. The `[odds_feed]` section becomes:

```toml
[odds_feed]
provider = "the-odds-api"
base_url = "https://api.the-odds-api.com"
bookmakers = "draftkings,fanduel,betmgm,caesars"
live_poll_interval_s = 20
pre_game_poll_interval_s = 120
quota_warning_threshold = 100
```

And add before it (or anywhere logical):

```toml
[sports]
basketball = true
american-football = true
baseball = true
ice-hockey = true
college-basketball = true
college-basketball-womens = true
soccer-epl = true
mma = true
```

**Step 2: Add SportsConfig to config.rs**

Add after the `KalshiConfig` struct (~line 50):

```rust
#[derive(Debug, Deserialize, Clone)]
pub struct SportsConfig {
    #[serde(default)]
    pub basketball: bool,
    #[serde(default, alias = "american-football")]
    pub american_football: bool,
    #[serde(default)]
    pub baseball: bool,
    #[serde(default, alias = "ice-hockey")]
    pub ice_hockey: bool,
    #[serde(default, alias = "college-basketball")]
    pub college_basketball: bool,
    #[serde(default, alias = "college-basketball-womens")]
    pub college_basketball_womens: bool,
    #[serde(default, alias = "soccer-epl")]
    pub soccer_epl: bool,
    #[serde(default)]
    pub mma: bool,
}

impl Default for SportsConfig {
    fn default() -> Self {
        Self {
            basketball: true,
            american_football: true,
            baseball: true,
            ice_hockey: true,
            college_basketball: true,
            college_basketball_womens: true,
            soccer_epl: true,
            mma: true,
        }
    }
}
```

**Step 3: Update Config struct and OddsFeedConfig**

Add `pub sports: SportsConfig` to the `Config` struct. Give it a `serde(default)` so missing section uses defaults.

Remove `pub sports: Vec<String>` from `OddsFeedConfig`.

```rust
#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct Config {
    pub strategy: StrategyConfig,
    pub risk: RiskConfig,
    pub execution: ExecutionConfig,
    pub kalshi: KalshiConfig,
    pub odds_feed: OddsFeedConfig,
    pub momentum: MomentumConfig,
    pub score_feed: Option<ScoreFeedConfig>,
    pub college_score_feed: Option<CollegeScoreFeedConfig>,
    pub simulation: Option<SimulationConfig>,
    pub win_prob: Option<WinProbConfig>,
    pub college_win_prob: Option<WinProbConfig>,
    #[serde(default)]
    pub sports: SportsConfig,
}
```

Remove `sports` from `OddsFeedConfig`:

```rust
#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct OddsFeedConfig {
    pub provider: String,
    pub base_url: String,
    pub bookmakers: String,
    pub live_poll_interval_s: Option<u64>,
    pub pre_game_poll_interval_s: Option<u64>,
    pub quota_warning_threshold: Option<u64>,
}
```

**Step 4: Update config test**

The existing `test_config_parses` test accesses `config.odds_feed.live_poll_interval_s`. Remove the dead `odds_feed.sports` assertion if any, and add a check for the new sports section:

```rust
#[test]
fn test_config_parses() {
    let config = Config::load(Path::new("config.toml")).unwrap();
    assert_eq!(config.momentum.maker_momentum_threshold, 40);
    assert_eq!(config.momentum.taker_momentum_threshold, 75);
    assert_eq!(config.momentum.cancel_threshold, 30);
    assert!(config.odds_feed.live_poll_interval_s.is_some());
    assert!(config.sports.basketball);
}
```

**Step 5: Run tests and verify**

Run: `cargo test -p kalshi-arb -- --test-output immediate`
Expected: All tests pass, including `test_config_parses` with the new sports field.

**Step 6: Commit**

```bash
git add kalshi-arb/config.toml kalshi-arb/src/config.rs
git commit -m "feat(config): add [sports] section with per-sport enable flags"
```

---

### Task 2: Add SPORT_REGISTRY and EnabledSports to main.rs

**Files:**
- Modify: `kalshi-arb/src/main.rs:1-20` (imports), `kalshi-arb/src/main.rs:819-828` (sport_series)

**Step 1: Add SPORT_REGISTRY constant**

Add after imports, before `SportProcessResult` (~line 20):

```rust
pub struct SportDef {
    pub key: &'static str,
    pub series: &'static str,
    pub label: &'static str,
    pub hotkey: char,
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

**Step 2: Add EnabledSports struct**

Add after `SPORT_REGISTRY`:

```rust
pub struct EnabledSports {
    map: HashMap<String, bool>,
    config_path: std::path::PathBuf,
}

impl EnabledSports {
    pub fn from_config(sports: &config::SportsConfig, config_path: std::path::PathBuf) -> Self {
        let mut map = HashMap::new();
        map.insert("basketball".to_string(), sports.basketball);
        map.insert("american-football".to_string(), sports.american_football);
        map.insert("baseball".to_string(), sports.baseball);
        map.insert("ice-hockey".to_string(), sports.ice_hockey);
        map.insert("college-basketball".to_string(), sports.college_basketball);
        map.insert("college-basketball-womens".to_string(), sports.college_basketball_womens);
        map.insert("soccer-epl".to_string(), sports.soccer_epl);
        map.insert("mma".to_string(), sports.mma);
        Self { map, config_path }
    }

    pub fn is_enabled(&self, sport_key: &str) -> bool {
        self.map.get(sport_key).copied().unwrap_or(false)
    }

    pub fn toggle(&mut self, sport_key: &str) {
        if let Some(val) = self.map.get_mut(sport_key) {
            *val = !*val;
            self.persist();
        }
    }

    fn persist(&self) {
        let Ok(content) = std::fs::read_to_string(&self.config_path) else { return };
        let Ok(mut doc) = content.parse::<toml::Value>() else { return };
        if let Some(table) = doc.as_table_mut() {
            let sports_table = table.entry("sports")
                .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
            if let Some(st) = sports_table.as_table_mut() {
                for (key, enabled) in &self.map {
                    st.insert(key.clone(), toml::Value::Boolean(*enabled));
                }
            }
            let _ = std::fs::write(&self.config_path, toml::to_string_pretty(&doc).unwrap_or_default());
        }
    }

    /// Returns list of enabled sport keys (for building odds_sports list, etc.)
    pub fn enabled_keys(&self) -> Vec<String> {
        self.map.iter()
            .filter(|(_, &v)| v)
            .map(|(k, _)| k.clone())
            .collect()
    }
}
```

**Step 3: Replace sport_series vec with SPORT_REGISTRY**

Replace lines 819-828:

```rust
let sport_series = vec![
    ("basketball", "KXNBAGAME"),
    ...
];
```

With:

```rust
let sport_series: Vec<(&str, &str)> = SPORT_REGISTRY.iter()
    .map(|sd| (sd.key, sd.series))
    .collect();
```

**Step 4: Initialize EnabledSports and wrap in Arc<Mutex>**

After config is loaded and before `state_tx` creation (~line 810), add:

```rust
let enabled_sports = Arc::new(Mutex::new(
    EnabledSports::from_config(&config.sports, Path::new("config.toml").to_path_buf())
));
```

**Step 5: Replace odds_sports derivation**

Replace lines 963-967:

```rust
let odds_sports: Vec<String> = config.odds_feed.sports.iter()
    .filter(|s| !(config.score_feed.is_some() && s.as_str() == "basketball"))
    .filter(|s| !(config.college_score_feed.is_some() && (s.as_str() == "college-basketball" || s.as_str() == "college-basketball-womens")))
    .cloned()
    .collect();
```

With:

```rust
let odds_sports: Vec<String> = {
    let es = enabled_sports.lock().unwrap();
    SPORT_REGISTRY.iter()
        .filter(|sd| es.is_enabled(sd.key))
        .map(|sd| sd.key.to_string())
        .filter(|s| !(config.score_feed.is_some() && s.as_str() == "basketball"))
        .filter(|s| !(config.college_score_feed.is_some() && (s == "college-basketball" || s == "college-basketball-womens")))
        .collect()
};
```

**Step 6: Run `cargo check` to verify compilation**

Run: `cargo check -p kalshi-arb`
Expected: Compiles with possible warnings about unused `enabled_sports` in engine task (that's fine for now).

**Step 7: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat: add SPORT_REGISTRY and EnabledSports shared state"
```

---

### Task 3: Gate main loop fetching on EnabledSports

**Files:**
- Modify: `kalshi-arb/src/main.rs:1024` (engine task), `kalshi-arb/src/main.rs:1137-1263` (score feeds), `kalshi-arb/src/main.rs:1265-1424` (odds + diagnostic loops)

**Step 1: Clone Arc into engine task**

Before `tokio::spawn(async move {` (~line 1024), add:

```rust
let enabled_sports_engine = enabled_sports.clone();
```

Move this clone into the async block (add to the list of captured variables).

**Step 2: Re-derive odds_sports each loop iteration**

Inside the engine loop, at the top of each iteration (after `accumulated_rows.clear()` ~line 1134), replace the static `odds_sports` with a dynamic derivation:

```rust
let odds_sports: Vec<String> = {
    let es = enabled_sports_engine.lock().unwrap();
    SPORT_REGISTRY.iter()
        .filter(|sd| es.is_enabled(sd.key))
        .map(|sd| sd.key.to_string())
        .filter(|s| !(score_poller.is_some() && s.as_str() == "basketball"))
        .filter(|s| !(college_score_poller.is_some() && (s == "college-basketball" || s == "college-basketball-womens")))
        .collect()
};
```

Remove the outer `let odds_sports` that was computed once at line 963. Instead, just keep the filter logic for score_feed exclusion. The outer `odds_sports` can stay but be unused — or remove it entirely and compute inside the loop.

**Step 3: Gate NBA score feed on enabled state**

Wrap the NBA score feed block (~line 1137) with a check:

```rust
let nba_enabled = enabled_sports_engine.lock().unwrap().is_enabled("basketball");
if nba_enabled {
    if let Some(ref mut poller) = score_poller {
        // ... existing score feed logic ...
    }
}
```

**Step 4: Gate college score feeds on enabled state**

Wrap the college score feed block (~line 1195) similarly. Split into two checks since men's and women's can be toggled independently:

```rust
if let Some(ref mut college_poller) = college_score_poller {
    let mens_enabled = enabled_sports_engine.lock().unwrap().is_enabled("college-basketball");
    let womens_enabled = enabled_sports_engine.lock().unwrap().is_enabled("college-basketball-womens");

    // Only fetch if at least one is enabled
    if mens_enabled || womens_enabled {
        // ... existing fetch logic (lines 1204-1226) ...
    }

    // Process men's only if enabled
    if mens_enabled && !college_mens_cached.is_empty() {
        // ... existing men's processing (lines 1229-1244) ...
    }

    // Process women's only if enabled
    if womens_enabled && !college_womens_cached.is_empty() {
        // ... existing women's processing (lines 1247-1262) ...
    }
}
```

**Step 5: Gate diagnostic-only fetch on enabled state**

Replace the diagnostic-only loop (~line 1396-1424) to also check enabled state. Change `for sport in &config.odds_feed.sports {` to use a list derived from `SPORT_REGISTRY` and check enabled:

```rust
// Diagnostic-only fetch for score-feed sports
for sd in SPORT_REGISTRY {
    let sport = sd.key;
    if odds_sports.iter().any(|s| s == sport) {
        continue; // already handled in the odds loop above
    }
    if !enabled_sports_engine.lock().unwrap().is_enabled(sport) {
        continue; // sport is toggled off
    }
    // ... rest of existing diagnostic fetch logic, using `sport` instead of `sport.as_str()` ...
}
```

**Step 6: Update FetchDiagnostic handler**

In the `TuiCommand::FetchDiagnostic` handler (~line 1077-1119), replace `for diag_sport in &config.odds_feed.sports {` with:

```rust
let enabled_keys: Vec<String> = enabled_sports_engine.lock().unwrap().enabled_keys();
for diag_sport in &enabled_keys {
```

**Step 7: Run `cargo check` to verify**

Run: `cargo check -p kalshi-arb`
Expected: Compiles cleanly.

**Step 8: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat: gate all fetch/eval paths on EnabledSports toggle state"
```

---

### Task 4: Add TUI hotkey handling for sport toggles

**Files:**
- Modify: `kalshi-arb/src/tui/mod.rs:1-261`
- Modify: `kalshi-arb/src/tui/state.rs:1-26,120-161`

**Step 1: Add ToggleSport command to TuiCommand**

In `tui/mod.rs`, add a new variant to `TuiCommand`:

```rust
pub enum TuiCommand {
    Quit,
    Pause,
    Resume,
    FetchDiagnostic,
    ToggleSport(String),
}
```

**Step 2: Add enabled_sports to AppState**

In `tui/state.rs`, add the import and field:

```rust
use std::sync::{Arc, Mutex};
```

Add to `AppState`:

```rust
pub enabled_sports: Option<Arc<Mutex<crate::EnabledSports>>>,
```

In `AppState::new()`, initialize:

```rust
enabled_sports: None,
```

**Step 3: Handle number keys in the TUI event loop**

In `tui/mod.rs`, in the default (no focus) branch of key handling (~line 216-253), add before the final `_ => {}`:

```rust
KeyCode::Char(c @ '1'..='8') => {
    // Look up sport by hotkey
    if let Some(sd) = crate::SPORT_REGISTRY.iter().find(|sd| sd.hotkey == c) {
        let _ = cmd_tx.send(TuiCommand::ToggleSport(sd.key.to_string())).await;
    }
}
```

Also add the same hotkey handling in ALL focus modes (log_focus, market_focus, position_focus, trade_focus, diagnostic_focus) in their `_ => {}` catch-all:

```rust
KeyCode::Char(c @ '1'..='8') => {
    if let Some(sd) = crate::SPORT_REGISTRY.iter().find(|sd| sd.hotkey == c) {
        let _ = cmd_tx.send(TuiCommand::ToggleSport(sd.key.to_string())).await;
    }
}
```

**Step 4: Handle ToggleSport command in engine loop**

In `main.rs`, in the TUI command handler (~line 1066-1121), add:

```rust
tui::TuiCommand::ToggleSport(sport_key) => {
    enabled_sports_engine.lock().unwrap().toggle(&sport_key);
    tracing::info!(sport = sport_key.as_str(), "sport toggled");
}
```

**Step 5: Pass enabled_sports into AppState**

Where `AppState::new()` is created (~line 811), set the `enabled_sports` field:

```rust
let (state_tx, state_rx) = watch::channel({
    let mut s = AppState::new();
    s.sim_mode = sim_mode;
    s.enabled_sports = Some(enabled_sports.clone());
    s
});
```

**Step 6: Run `cargo check`**

Run: `cargo check -p kalshi-arb`
Expected: Compiles. Warnings about unused `enabled_sports` in render are fine for now.

**Step 7: Commit**

```bash
git add kalshi-arb/src/main.rs kalshi-arb/src/tui/mod.rs kalshi-arb/src/tui/state.rs
git commit -m "feat(tui): add hotkey 1-8 to toggle sports on/off at runtime"
```

---

### Task 5: Add sport legend to TUI footer

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:91-112` (default layout), `kalshi-arb/src/tui/render.rs:821-853` (draw_footer)

**Step 1: Add sport legend rendering function**

Add a new function after `draw_footer`:

```rust
fn draw_sport_legend(f: &mut Frame, state: &AppState, area: Rect) {
    let mut spans: Vec<Span> = vec![Span::raw("  ")];

    for sd in crate::SPORT_REGISTRY {
        let enabled = state.enabled_sports.as_ref()
            .and_then(|es| es.lock().ok())
            .map(|es| es.is_enabled(sd.key))
            .unwrap_or(true);

        let style = if enabled {
            Style::default().fg(Color::Green)
        } else {
            Style::default().fg(Color::DarkGray)
        };

        spans.push(Span::styled(format!("[{}]", sd.hotkey), Style::default().fg(Color::Yellow)));
        spans.push(Span::styled(sd.label, style));
        spans.push(Span::raw(" "));
    }

    let line = Line::from(spans);
    let para = Paragraph::new(line);
    f.render_widget(para, area);
}
```

**Step 2: Update default layout to include sport legend line**

In the default layout (~line 91-112), add an extra `Constraint::Length(1)` for the sport legend:

```rust
    } else {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(header_height),
                Constraint::Min(8),
                Constraint::Length(6),
                Constraint::Length(6),
                Constraint::Min(5),
                Constraint::Length(1),
                Constraint::Length(1),
                Constraint::Length(1),  // new: sport legend
            ])
            .split(f.area());

        draw_header(f, state, chunks[0], spinner_frame);
        draw_markets(f, state, chunks[1]);
        draw_positions(f, state, chunks[2]);
        draw_trades(f, state, chunks[3]);
        draw_logs(f, state, chunks[4]);
        draw_api_status(f, state, chunks[5]);
        draw_footer(f, state, chunks[6]);
        draw_sport_legend(f, state, chunks[7]);
    }
```

**Step 3: Add sport legend to focused views too**

For each focused view (log, market, position, trade), change the footer constraint from `Length(1)` to `Length(2)` (or add a second `Length(1)`), and add `draw_sport_legend` below:

For example, for log_focus:

```rust
    } else if state.log_focus {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(header_height),
                Constraint::Min(0),
                Constraint::Length(1),
                Constraint::Length(1),  // sport legend
            ])
            .split(f.area());

        draw_header(f, state, chunks[0], spinner_frame);
        draw_logs(f, state, chunks[1]);
        draw_footer(f, state, chunks[2]);
        draw_sport_legend(f, state, chunks[3]);
    }
```

Apply the same pattern to `market_focus`, `position_focus`, `trade_focus`, and `diagnostic_focus` (replacing `draw_diagnostic_footer` area).

For diagnostic_focus, add the legend below the diagnostic footer:

```rust
    if state.diagnostic_focus {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Min(0),
                Constraint::Length(1),
                Constraint::Length(1),  // sport legend
            ])
            .split(f.area());

        draw_diagnostic_header(f, state, chunks[0]);
        draw_diagnostic(f, state, chunks[1]);
        draw_diagnostic_footer(f, chunks[2]);
        draw_sport_legend(f, state, chunks[3]);
    }
```

**Step 4: Run `cargo check`**

Run: `cargo check -p kalshi-arb`
Expected: Compiles cleanly.

**Step 5: Run tests**

Run: `cargo test -p kalshi-arb -- --test-output immediate`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(tui): add persistent sport toggle legend to all views"
```

---

### Task 6: Final integration test and cleanup

**Files:**
- Modify: `kalshi-arb/src/main.rs` (remove any dead code/unused vars)

**Step 1: Remove the outer odds_sports derivation**

The `odds_sports` computed at ~line 963 is now recomputed each loop iteration. Remove the outer one entirely to avoid confusion. Keep only the one inside the loop.

**Step 2: Clean up any remaining `config.odds_feed.sports` references**

Search for `config.odds_feed.sports` — all references should now be replaced with `SPORT_REGISTRY`-based or `enabled_sports`-based lookups.

**Step 3: Run full build and test**

Run: `cargo build -p kalshi-arb && cargo test -p kalshi-arb -- --test-output immediate`
Expected: Clean build, all tests pass.

**Step 4: Commit any cleanup**

```bash
git add kalshi-arb/src/main.rs
git commit -m "refactor: remove dead odds_feed.sports references, use SPORT_REGISTRY throughout"
```
