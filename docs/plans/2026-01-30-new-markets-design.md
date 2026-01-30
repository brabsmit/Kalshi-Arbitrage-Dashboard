# New Markets Design: NCAAB, EPL, UFC

## Overview

Add three new markets to the Kalshi arbitrage bot:

| Sport | Kalshi Series | The Odds API Key | Markets/Event | In Season |
|-------|---------------|------------------|---------------|-----------|
| College Basketball (NCAAB) | `KXNCAABGAME` | `basketball_ncaab` | 2 (home/away) | Peak (March Madness coming) |
| English Premier League (EPL) | `KXEPLGAME` | `soccer_epl` | 3 (home/away/draw) | Mid-season (Aug-May) |
| UFC/MMA | `KXUFCFIGHT` | `mma_mixed_martial_arts` | 2 (fighter1/fighter2) | Year-round |

## Design

### 1. Configuration & Wiring

**`main.rs` `sport_series` (line 70):**

```rust
let sport_series = vec![
    ("basketball",        "KXNBAGAME"),
    ("american-football", "KXNFLGAME"),
    ("baseball",          "KXMLBGAME"),
    ("ice-hockey",        "KXNHLGAME"),
    // New markets:
    ("college-basketball", "KXNCAABGAME"),
    ("soccer-epl",         "KXEPLGAME"),
    ("mma",                "KXUFCFIGHT"),
];
```

**`the_odds_api.rs` `api_sport_key()`:**

```rust
fn api_sport_key(sport: &str) -> &str {
    match sport {
        "basketball"         => "basketball_nba",
        "american-football"  => "americanfootball_nfl",
        "baseball"           => "baseball_mlb",
        "ice-hockey"         => "icehockey_nhl",
        "college-basketball" => "basketball_ncaab",
        "soccer-epl"         => "soccer_epl",
        "mma"                => "mma_mixed_martial_arts",
        _ => sport,
    }
}
```

**`config.toml`:**

```toml
sports = [
    "basketball", "american-football", "baseball", "ice-hockey",
    "college-basketball", "soccer-epl", "mma"
]
```

### 2. Title Parsing & Name Normalization

#### NCAAB

No parser changes needed. Kalshi NCAAB uses the same "X at Y Winner?" title format
as NBA/NFL. College mascot suffixes are already in `normalize_team()` (lines 81-88).

Name collision risk (e.g., "Indiana Hoosiers" and "Indiana State Sycamores" both
normalizing to `INDIANA`) is mitigated by the market key including sport + date +
both team names — collisions require two teams with identical normalized city names
playing each other on the same day, which doesn't happen.

#### EPL

`parse_kalshi_title()` already handles the "vs" format used by EPL titles
(e.g., "Brentford vs Arsenal Winner?").

**Do NOT add EPL team name suffixes** to `normalize_team()`. EPL club names are
already clean and consistent across Kalshi and The Odds API. Adding suffixes like
"UNITED" or "CITY" would cause collisions (Manchester United and Manchester City
would both normalize to `MANCHESTER`). Instead, rely on the existing alphanumeric
normalization: "Manchester United" becomes `MANCHESTERUNITED`.

#### UFC

UFC titles use a different format that doesn't match `parse_kalshi_title()`:

> "Will Alex Volkanovski win the Volkanovski vs Lopes professional MMA fight
> scheduled for Jan 31, 2026?"

**New parser: `parse_ufc_title()`:**

1. Extract full fighter name from between "Will " and " win the" in each market title
2. Extract event fighter pair from between "the " and " professional MMA fight"
3. Split the event portion on " vs " to determine fighter ordering (fighter1 vs fighter2)

**Matching strategy:** Use the full fighter name from the market title (e.g.,
"Alex Volkanovski") for key generation, not the abbreviated event portion.
The Odds API also returns full names, so both sides normalize the same way.
No suffix stripping needed for fighter names.

The ticker structure (`KXUFCFIGHT-26JAN31VOLLOP-VOL`) works with the existing
`is_away_market()` logic — `VOL` starts `VOLLOP`, making it the "away" (fighter1) side.

### 3. 3-Way Market Support (EPL)

EPL has three outcomes per game: home win, away win, and draw. This requires
structural changes in three areas.

#### A. `IndexedGame` struct

Add a `draw` field:

```rust
pub struct IndexedGame {
    pub away: Option<SideMarket>,
    pub home: Option<SideMarket>,
    pub draw: Option<SideMarket>,  // new — for soccer ties
    pub away_team: String,
    pub home_team: String,
}
```

During market indexing in `main.rs`, detect TIE markets by checking if the ticker's
winner code is `TIE` (e.g., `KXEPLGAME-26FEB12BREARS-TIE`). Store these in the
`draw` field.

#### B. 3-way devig

Add a `devig_3way()` function in `strategy.rs`:

```
home_implied + away_implied + draw_implied = total
home_fair = home_implied / total
away_fair = away_implied / total
draw_fair = draw_implied / total
```

The Odds API returns 3 outcomes for soccer h2h markets (Home, Away, Draw).
Add an optional `draw_odds` field to `BookmakerOdds` in `feed/types.rs`.

#### C. Strategy evaluation

In the polling loop in `main.rs`, after matching a soccer game, evaluate **three**
separate strategy signals:

1. Home win market: fair_value = home_fair vs Kalshi home market bid/ask
2. Away win market: fair_value = away_fair vs Kalshi away market bid/ask
3. Draw market: fair_value = draw_fair vs Kalshi draw market bid/ask

The strategy engine (`evaluate()`) doesn't change — it already takes a single
`fair_value` and `bid/ask` pair. Each of the 3 markets is evaluated independently.

The TUI displays three `MarketRow` entries per EPL game instead of the usual two
(e.g., "Arsenal WIN", "Brentford WIN", "Draw").

### 4. Files Changed

| File | Change |
|------|--------|
| `config.toml` | Add 3 sports to `sports` array |
| `src/main.rs` | Add 3 entries to `sport_series`; handle `draw`/`TIE` markets during indexing; evaluate 3 signals for soccer |
| `src/feed/the_odds_api.rs` | Add 3 mappings to `api_sport_key()`; parse 3-way h2h outcomes for soccer |
| `src/feed/types.rs` | Add optional `draw_odds` to `BookmakerOdds`; add optional `draw_team` to `OddsUpdate` |
| `src/engine/matcher.rs` | Add `draw` field to `IndexedGame`; add `parse_ufc_title()` parser |
| `src/engine/strategy.rs` | Add `devig_3way()` function |

**No changes needed to:** `fees.rs`, `risk.rs`, `ws.rs`, `auth.rs`, `rest.rs`,
`tui/` (market rows are generated dynamically).
