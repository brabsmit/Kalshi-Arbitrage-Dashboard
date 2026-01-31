# Per-Sport Pipeline Refactor

## Problem

The main event loop in `main.rs` has grown to ~800 lines of sport-specific branching.
Two fundamentally different evaluation pipelines (score-based and odds-based) are
stitched together with ad-hoc `if` statements, manual sport exclusion lists, and
copy-pasted code blocks. This creates three compounding problems:

1. **Too many code paths** - the main loop has separate branches for score feeds,
   odds feeds, and per-sport logic that are hard to follow
2. **Config is unclear** - looking at `config.toml` doesn't reveal which sources feed
   into which evaluators for a given sport
3. **Simulation opacity** - when running a simulation, you can't trace which data
   source produced a given signal or trade decision

## Design

### Per-Sport Pipeline Config

Each sport declares its full pipeline explicitly in config. The key field is
`fair_value` which determines how fair value is computed - no more implicit
exclusion lists in code.

```toml
# --- Shared resources ---
[kalshi]
api_base = "https://api.elections.kalshi.com"
ws_url = "wss://api.elections.kalshi.com/trade-api/ws/v2"

[odds_sources.the-odds-api]
type = "the-odds-api"
base_url = "https://api.the-odds-api.com"
bookmakers = "draftkings,fanduel,betmgm,caesars"
live_poll_s = 20
pre_game_poll_s = 120
quota_warning_threshold = 100

[odds_sources.draftkings]
type = "draftkings"
live_poll_s = 3
pre_game_poll_s = 30
request_timeout_ms = 5000

# --- Global defaults ---
[strategy]
taker_edge_threshold = 5
maker_edge_threshold = 2
min_edge_after_fees = 1

[risk]
kelly_fraction = 0.25
max_contracts_per_market = 10
max_total_exposure_cents = 50000
max_concurrent_markets = 5

[momentum]
taker_momentum_threshold = 75
maker_momentum_threshold = 40
cancel_threshold = 30
velocity_weight = 0.6
book_pressure_weight = 0.4
velocity_window_size = 10

[execution]
maker_timeout_ms = 2000
stale_odds_threshold_ms = 30000

[simulation]
latency_ms = 500
use_break_even_exit = true

# --- Per-sport pipelines ---
[sports.basketball]
enabled = true
kalshi_series = "KXNBAGAME"
label = "NBA"
hotkey = "1"
fair_value = "score-feed"
odds_source = "the-odds-api"

[sports.basketball.score_feed]
primary_url = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json"
fallback_url = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
live_poll_s = 1
pre_game_poll_s = 60
failover_threshold = 3
request_timeout_ms = 5000

[sports.basketball.win_prob]
home_advantage = 2.5
k_start = 0.065
k_range = 0.25
ot_k_start = 0.10
ot_k_range = 1.0
regulation_secs = 2880

[sports.basketball.strategy]
taker_edge_threshold = 3
maker_edge_threshold = 1

[sports.basketball.momentum]
taker_momentum_threshold = 0
maker_momentum_threshold = 0

[sports.college-basketball]
enabled = true
kalshi_series = "KXNCAAMBGAME"
label = "NCAAM"
hotkey = "5"
fair_value = "score-feed"
odds_source = "the-odds-api"

[sports.college-basketball.score_feed]
primary_url = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50&limit=400"
live_poll_s = 1
pre_game_poll_s = 60
request_timeout_ms = 5000

[sports.college-basketball.win_prob]
home_advantage = 3.5
k_start = 0.065
k_range = 0.25
ot_k_start = 0.10
ot_k_range = 1.0
regulation_secs = 2400

[sports.college-basketball-womens]
enabled = true
kalshi_series = "KXNCAAWBGAME"
label = "NCAAW"
hotkey = "6"
fair_value = "score-feed"
odds_source = "the-odds-api"

[sports.college-basketball-womens.score_feed]
primary_url = "https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard?groups=50&limit=400"
live_poll_s = 1
pre_game_poll_s = 60
request_timeout_ms = 5000

[sports.college-basketball-womens.win_prob]
home_advantage = 3.5
k_start = 0.065
k_range = 0.25
ot_k_start = 0.10
ot_k_range = 1.0
regulation_secs = 2400

[sports.american-football]
enabled = false
kalshi_series = "KXNFLGAME"
label = "NFL"
hotkey = "2"
fair_value = "odds-feed"
odds_source = "the-odds-api"

[sports.baseball]
enabled = true
kalshi_series = "KXMLBGAME"
label = "MLB"
hotkey = "3"
fair_value = "odds-feed"
odds_source = "the-odds-api"

[sports.ice-hockey]
enabled = true
kalshi_series = "KXNHLGAME"
label = "NHL"
hotkey = "4"
fair_value = "odds-feed"
odds_source = "the-odds-api"

[sports.soccer-epl]
enabled = true
kalshi_series = "KXEPLGAME"
label = "EPL"
hotkey = "7"
fair_value = "odds-feed"
odds_source = "the-odds-api"

[sports.mma]
enabled = true
kalshi_series = "KXUFCFIGHT"
label = "UFC"
hotkey = "8"
fair_value = "odds-feed"
odds_source = "the-odds-api"
```

### Odds Feeds as Named Sources

Odds feeds are declared once as named sources under `[odds_sources.*]`. Each sport
references which source it uses via `odds_source = "the-odds-api"`. For score-feed
sports, the odds source is only used for the diagnostic panel. For odds-feed sports,
it provides the fair value.

This means different sports can use different sources naturally - MMA on DraftKings,
NHL on the-odds-api - without global dispatch logic.

Multi-source strategies (blend, fallback) are deferred. Start with single source per
sport and add composition later only if needed.

### Pipeline Trait in Code

Replace the branching main loop with a uniform pipeline per sport.

```rust
enum FairValueSource {
    ScoreFeed {
        poller: ScorePoller,
        win_prob: WinProbTable,
    },
    OddsFeed {
        source_name: String,
    },
}

struct SportPipeline {
    key: String,
    series: String,
    label: String,
    hotkey: char,
    enabled: bool,

    fair_value: FairValueSource,
    odds_source: String,

    // Resolved config (sport override or global default)
    strategy_config: StrategyConfig,
    momentum_config: MomentumConfig,

    // Per-sport polling state (moved out of loose HashMaps in main)
    last_poll: Option<Instant>,
    cached_updates: Vec<OddsUpdate>,
    cached_scores: Vec<ScoreUpdate>,
    last_score_fetch: HashMap<String, Instant>,
    diagnostic_rows: Vec<DiagnosticRow>,
    commence_times: Vec<String>,
}
```

The main loop becomes:

```rust
loop {
    drain_tui_commands();
    let bankroll = compute_bankroll();

    for pipeline in &mut sport_pipelines {
        if !pipeline.enabled { continue; }

        let result = pipeline.tick(
            cycle_start,
            &market_index,
            &live_book,
            &mut odds_sources,
            &mut velocity_trackers,
            &mut book_pressure_trackers,
            &scorer,
            &risk_config,
            &sim_config,
            sim_mode,
            bankroll,
        );

        accumulated_rows.extend(result.rows);
        filter_live += result.filter_live;
        // ...
    }

    update_tui(accumulated_rows, filter_stats);
    idle_sleep_if_needed();
}
```

Each `SportPipeline::tick()` encapsulates: poll timing, fetch-or-replay, fair value
computation (score-based or odds-based), matching, strategy evaluation, simulation
execution. The main loop drops from ~800 lines to ~50.

### Signal Trace for Simulation Observability

Each evaluation produces a `SignalTrace` that travels with the trade:

```rust
struct SignalTrace {
    sport: String,
    ticker: String,
    timestamp: Instant,
    fair_value_method: FairValueMethod,
    fair_value_cents: u32,
    inputs: FairValueInputs,
    best_bid: u32,
    best_ask: u32,
    signal: StrategySignal,
    momentum_score: f64,
    momentum_gated: bool,
}

enum FairValueMethod {
    ScoreFeed { source: String },
    OddsFeed { source: String },
}

enum FairValueInputs {
    Score {
        home_score: u32,
        away_score: u32,
        elapsed_secs: u32,
        period: String,
        win_prob: f64,
    },
    Odds {
        home_odds: f64,
        away_odds: f64,
        bookmakers: Vec<String>,
        devigged_prob: f64,
    },
}
```

`SimPosition` carries its `SignalTrace`, so the TUI trades view shows:

```
TICKER          ENTRY  EXIT  EDGE  SOURCE     FAIR VALUE BASIS
KXNBA-LAL-G1    42c   55c   +8   score-feed  LAL 78-71 Q3 4:32 (wp=0.68)
KXNHL-BOS-G2    38c   44c   +3   odds-api    devig: BOS -180 / OPP +155
```

### Per-Sport Strategy Overrides

Strategy and momentum configs have global defaults. Sports can optionally override
any field. At pipeline construction time, overrides are resolved:

```rust
impl SportPipeline {
    fn strategy_config(&self) -> &StrategyConfig {
        // Already resolved at construction: sport override merged over global
        &self.strategy_config
    }
}
```

This eliminates the `bypass_for_score_signals` hack. Score-feed sports simply
configure `taker_momentum_threshold = 0` directly.

### Config TUI View

A full-screen config editor activated by hotkey (`c`), with per-sport tabs and
live editing that persists to `config.toml`.

**Sport tab layout:**

```
 [NBA] [NCAAM] [NCAAW] [NFL] [MLB] [NHL] [EPL] [UFC] [Global]

  NBA Pipeline                              Status: * enabled

  Fair Value:  score-feed
  Odds Source: the-odds-api (diagnostic only)
  Kalshi:      KXNBAGAME

  Score Feed                    Strategy (override)
  -----------                   --------------------
  Primary:  cdn.nba.com         Taker edge:    [ 3]c
  Fallback: espn.com            Maker edge:    [ 1]c
  Live poll:    [ 1]s           Min net edge:  [ 1]c
  Pre-game:    [60]s
  Timeout:   [5000]ms           Momentum (override)
                                --------------------
  Win Prob Model                Taker thresh:  [ 0]
  --------------                Maker thresh:  [ 0]
  Home adv:   [2.5]
  k_start:  [0.065]
  k_range:   [0.25]
  Reg secs:  [2880]

  Up/Down navigate  Left/Right tabs  Enter edit  Esc back  d delete override
```

**Global tab** shows shared sections: strategy defaults, risk, momentum defaults,
simulation, odds sources (all editable).

**Interactions:**
- Left/Right or number keys cycle tabs
- Up/Down navigates editable fields (bracketed values)
- Enter opens inline edit, Enter confirms, Esc cancels
- Fields overriding global defaults highlighted in yellow
- `d` on an overridden field removes the override (reverts to global)
- Space on status line toggles sport enabled/disabled
- Every confirmed edit writes to `config.toml` immediately
- Running pipelines pick up new values on next tick (no restart)

**Implementation:**
- New `TuiCommand::OpenConfig` and `TuiCommand::UpdateConfigField` variants
- New `ConfigView` state struct in TUI (cursor position, active tab, edit mode)
- New `render_config()` function in `tui/render.rs`
- Pipelines re-read config values each tick (already the pattern for `enabled`)

## Code Changes

### New files

- `src/pipeline.rs` - `SportPipeline`, `FairValueSource`, `SignalTrace`, `tick()`
- `src/tui/config_view.rs` - config editor TUI view

### Modified files

- `src/config.rs` - rewritten to parse new TOML shape with per-sport pipelines
- `src/main.rs` - event loop shrinks to ~50 lines, construction builds
  `Vec<SportPipeline>` from config
- `src/tui/state.rs` - `SimPosition` gains `SignalTrace`, add `ConfigView` state
- `src/tui/render.rs` - trade view shows provenance, config view rendering
- `src/tui/mod.rs` - new `TuiCommand` variants, hotkey for config view
- `config.toml` - rewritten to new per-sport format

### Unchanged files

- `src/feed/*` - feed implementations stay as-is, called by pipeline instead of main
- `src/engine/strategy.rs` - evaluation logic unchanged
- `src/engine/matcher.rs` - matching logic unchanged
- `src/engine/win_prob.rs` - model unchanged
- `src/engine/kelly.rs` - sizing unchanged
- `src/engine/fees.rs` - fee calc unchanged
- `src/engine/risk.rs` - risk logic unchanged
- `src/kalshi/*` - API client unchanged

### Removed concepts

- `SPORT_REGISTRY` static array (derived from config)
- `EnabledSports` struct (replaced by `pipeline.enabled`)
- `source_strategy` global dispatch (per-sport `odds_source`)
- `fetch_odds!` macro (pipeline calls its source directly)
- `bypass_for_score_signals` flag (per-sport momentum config)
- `score_poller` / `college_score_poller` special-case branches
- 10+ loose `HashMap`s for polling state (encapsulated in pipeline)

## Implementation Order

1. Rewrite `config.rs` to parse new TOML shape (with backward-compat test)
2. Create `pipeline.rs` with `SportPipeline` struct and `tick()` method
3. Add `SignalTrace` and wire into `SimPosition`
4. Rewrite `main.rs` event loop to iterate pipelines
5. Add config TUI view (new tab, rendering, inline editing)
6. Update trade view to show signal provenance
7. Rewrite `config.toml` to new format
