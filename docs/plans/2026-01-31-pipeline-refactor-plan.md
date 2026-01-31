# Per-Sport Pipeline Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 800-line main event loop with per-sport pipeline objects driven by a declarative config, add signal tracing for simulation observability, and add a config TUI editor.

**Architecture:** Each sport becomes a `SportPipeline` that owns its polling state, config overrides, and fair-value source. The main loop iterates pipelines calling `tick()`. Config is restructured so each sport declares its full pipeline (fair value method, odds source, strategy/momentum overrides). A `SignalTrace` travels with every sim trade for provenance. A new TUI config view lets users inspect and edit pipeline config at runtime.

**Tech Stack:** Rust, serde + toml 0.8, ratatui 0.29, crossterm 0.28, tokio, async-trait

**Design doc:** `docs/plans/2026-01-31-pipeline-refactor-design.md`

---

## Task 1: Rewrite config.rs for new TOML shape

**Files:**
- Modify: `kalshi-arb/src/config.rs`
- Test: inline `#[cfg(test)]` module in same file

The new config parses `[sports.<key>]` tables with per-sport sub-tables. The old flat `SportsConfig`, `ScoreFeedConfig`, `CollegeScoreFeedConfig`, top-level `win_prob`/`college_win_prob`, `odds_feed`, and `draftkings_feed` sections are replaced.

**Step 1: Write failing test for new config shape**

Add to `kalshi-arb/src/config.rs` `#[cfg(test)]` module:

```rust
#[test]
fn test_new_config_parses() {
    let toml_str = r#"
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
cancel_check_interval_ms = 1000

[execution]
maker_timeout_ms = 2000
stale_odds_threshold_ms = 30000

[simulation]
latency_ms = 500
use_break_even_exit = true

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

[sports.ice-hockey]
enabled = true
kalshi_series = "KXNHLGAME"
label = "NHL"
hotkey = "4"
fair_value = "odds-feed"
odds_source = "the-odds-api"
"#;
    let config: Config = toml::from_str(toml_str).unwrap();
    assert_eq!(config.kalshi.api_base, "https://api.elections.kalshi.com");
    assert_eq!(config.strategy.taker_edge_threshold, 5);
    assert_eq!(config.sports.len(), 2);

    let bball = &config.sports["basketball"];
    assert!(bball.enabled);
    assert_eq!(bball.kalshi_series, "KXNBAGAME");
    assert_eq!(bball.fair_value, "score-feed");
    assert!(bball.score_feed.is_some());
    assert!(bball.win_prob.is_some());
    assert_eq!(bball.strategy.as_ref().unwrap().taker_edge_threshold, 3);
    assert_eq!(bball.momentum.as_ref().unwrap().taker_momentum_threshold, 0);

    let hockey = &config.sports["ice-hockey"];
    assert_eq!(hockey.fair_value, "odds-feed");
    assert!(hockey.score_feed.is_none());
    assert!(hockey.strategy.is_none()); // uses global defaults
}
```

**Step 2: Run test to verify it fails**

Run: `cd kalshi-arb && cargo test test_new_config_parses -- --nocapture 2>&1`
Expected: Compile error — `Config` doesn't have `sports` field as `HashMap`.

**Step 3: Rewrite config structs**

Replace the contents of `config.rs` with new types. Keep `KalshiConfig`, `StrategyConfig`, `RiskConfig`, `ExecutionConfig`, `SimulationConfig`, `WinProbConfig`, `MomentumConfig` as-is (they're reused). Remove `SportsConfig`, `OddsFeedConfig`, `DraftKingsFeedConfig`, `ScoreFeedConfig`, `CollegeScoreFeedConfig`. Add:

```rust
use std::collections::HashMap;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub kalshi: KalshiConfig,
    pub odds_sources: HashMap<String, OddsSourceConfig>,
    pub strategy: StrategyConfig,
    pub risk: RiskConfig,
    pub momentum: MomentumConfig,
    pub execution: ExecutionConfig,
    #[serde(default)]
    pub simulation: SimulationConfig,
    pub sports: HashMap<String, SportConfig>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct OddsSourceConfig {
    #[serde(rename = "type")]
    pub source_type: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub bookmakers: Option<String>,
    #[serde(default = "default_live_poll")]
    pub live_poll_s: u64,
    #[serde(default = "default_pre_game_poll")]
    pub pre_game_poll_s: u64,
    #[serde(default)]
    pub quota_warning_threshold: Option<u64>,
    #[serde(default = "default_request_timeout")]
    pub request_timeout_ms: u64,
}

fn default_live_poll() -> u64 { 20 }
fn default_pre_game_poll() -> u64 { 120 }
fn default_request_timeout() -> u64 { 5000 }

#[derive(Debug, Deserialize, Clone)]
pub struct SportConfig {
    pub enabled: bool,
    pub kalshi_series: String,
    pub label: String,
    pub hotkey: String,
    pub fair_value: String,           // "score-feed" or "odds-feed"
    pub odds_source: String,          // key into odds_sources
    pub score_feed: Option<ScoreFeedConfig>,
    pub win_prob: Option<WinProbConfig>,
    pub strategy: Option<StrategyOverride>,
    pub momentum: Option<MomentumOverride>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ScoreFeedConfig {
    pub primary_url: String,
    #[serde(default)]
    pub fallback_url: Option<String>,
    #[serde(default = "default_score_live_poll")]
    pub live_poll_s: u64,
    #[serde(default = "default_score_pre_game_poll")]
    pub pre_game_poll_s: u64,
    #[serde(default = "default_failover_threshold")]
    pub failover_threshold: u32,
    #[serde(default = "default_request_timeout")]
    pub request_timeout_ms: u64,
}

fn default_score_live_poll() -> u64 { 1 }
fn default_score_pre_game_poll() -> u64 { 60 }
fn default_failover_threshold() -> u32 { 3 }

/// Partial override — only the fields present in TOML are Some.
/// Resolved against global StrategyConfig at pipeline construction.
#[derive(Debug, Deserialize, Clone)]
pub struct StrategyOverride {
    pub taker_edge_threshold: Option<u8>,
    pub maker_edge_threshold: Option<u8>,
    pub min_edge_after_fees: Option<u8>,
}

/// Partial override — resolved against global MomentumConfig at construction.
#[derive(Debug, Deserialize, Clone)]
pub struct MomentumOverride {
    pub taker_momentum_threshold: Option<u8>,
    pub maker_momentum_threshold: Option<u8>,
    pub cancel_threshold: Option<u8>,
    pub velocity_weight: Option<f64>,
    pub book_pressure_weight: Option<f64>,
    pub velocity_window_size: Option<usize>,
    pub cancel_check_interval_ms: Option<u64>,
}
```

Keep the `Config::load()`, `load_env_file()`, credential methods, `sanitize_key()`, `save_env_var()` unchanged.

Add resolution helpers:

```rust
impl StrategyConfig {
    pub fn with_override(&self, ov: Option<&StrategyOverride>) -> StrategyConfig {
        match ov {
            None => self.clone(),
            Some(o) => StrategyConfig {
                taker_edge_threshold: o.taker_edge_threshold.unwrap_or(self.taker_edge_threshold),
                maker_edge_threshold: o.maker_edge_threshold.unwrap_or(self.maker_edge_threshold),
                min_edge_after_fees: o.min_edge_after_fees.unwrap_or(self.min_edge_after_fees),
            },
        }
    }
}

impl MomentumConfig {
    pub fn with_override(&self, ov: Option<&MomentumOverride>) -> MomentumConfig {
        match ov {
            None => self.clone(),
            Some(o) => MomentumConfig {
                taker_momentum_threshold: o.taker_momentum_threshold.unwrap_or(self.taker_momentum_threshold),
                maker_momentum_threshold: o.maker_momentum_threshold.unwrap_or(self.maker_momentum_threshold),
                cancel_threshold: o.cancel_threshold.unwrap_or(self.cancel_threshold),
                velocity_weight: o.velocity_weight.unwrap_or(self.velocity_weight),
                book_pressure_weight: o.book_pressure_weight.unwrap_or(self.book_pressure_weight),
                velocity_window_size: o.velocity_window_size.unwrap_or(self.velocity_window_size),
                cancel_check_interval_ms: o.cancel_check_interval_ms.unwrap_or(self.cancel_check_interval_ms),
                bypass_for_score_signals: false, // eliminated
            },
        }
    }
}
```

**Step 4: Run test to verify it passes**

Run: `cd kalshi-arb && cargo test test_new_config_parses -- --nocapture 2>&1`
Expected: PASS

**Step 5: Add override resolution test**

```rust
#[test]
fn test_strategy_override_resolution() {
    let global = StrategyConfig {
        taker_edge_threshold: 5,
        maker_edge_threshold: 2,
        min_edge_after_fees: 1,
    };
    let ov = StrategyOverride {
        taker_edge_threshold: Some(3),
        maker_edge_threshold: Some(1),
        min_edge_after_fees: None,
    };
    let resolved = global.with_override(Some(&ov));
    assert_eq!(resolved.taker_edge_threshold, 3);
    assert_eq!(resolved.maker_edge_threshold, 1);
    assert_eq!(resolved.min_edge_after_fees, 1); // inherited from global
}

#[test]
fn test_momentum_override_resolution() {
    let global = MomentumConfig {
        taker_momentum_threshold: 75,
        maker_momentum_threshold: 40,
        cancel_threshold: 30,
        velocity_weight: 0.6,
        book_pressure_weight: 0.4,
        velocity_window_size: 10,
        cancel_check_interval_ms: 1000,
        bypass_for_score_signals: true,
    };
    let ov = MomentumOverride {
        taker_momentum_threshold: Some(0),
        maker_momentum_threshold: Some(0),
        cancel_threshold: None,
        velocity_weight: None,
        book_pressure_weight: None,
        velocity_window_size: None,
        cancel_check_interval_ms: None,
    };
    let resolved = global.with_override(Some(&ov));
    assert_eq!(resolved.taker_momentum_threshold, 0);
    assert_eq!(resolved.maker_momentum_threshold, 0);
    assert_eq!(resolved.cancel_threshold, 30); // inherited
    assert!(!resolved.bypass_for_score_signals); // always false in new system
}
```

**Step 6: Run tests**

Run: `cd kalshi-arb && cargo test -- --nocapture 2>&1`
Expected: New tests pass. Old `test_config_parses` will fail (expects old shape) — delete it.

**Step 7: Commit**

```bash
cd kalshi-arb && git add src/config.rs
git commit -m "refactor(config): rewrite for per-sport pipeline TOML shape"
```

---

## Task 2: Write new config.toml

**Files:**
- Modify: `kalshi-arb/config.toml`

Replace the entire `config.toml` with the new per-sport pipeline format from the design doc. All 8 sports, `[odds_sources]` section, global defaults. Use exact URLs from the old config.

**Step 1: Write new config.toml**

Copy the full TOML from the design doc's config section. Verify all URLs match the old config exactly:
- NBA score: `https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`
- ESPN NBA: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard`
- ESPN mens CBB: `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50&limit=400`
- ESPN womens CBB: `https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard?groups=50&limit=400`
- Odds API: `https://api.the-odds-api.com`
- Kalshi API: `https://api.elections.kalshi.com`
- Kalshi WS: `wss://api.elections.kalshi.com/trade-api/ws/v2`

**Step 2: Run config parse test**

Run: `cd kalshi-arb && cargo test test_new_config_parses -- --nocapture 2>&1`
Expected: PASS (test uses inline TOML, not file, but validates shape)

**Step 3: Add file-based config test**

```rust
#[test]
fn test_config_file_parses() {
    let config = Config::load(std::path::Path::new("config.toml")).unwrap();
    assert_eq!(config.sports.len(), 8);
    assert!(config.odds_sources.contains_key("the-odds-api"));
    assert_eq!(config.sports["basketball"].fair_value, "score-feed");
    assert_eq!(config.sports["ice-hockey"].fair_value, "odds-feed");
}
```

**Step 4: Run tests**

Run: `cd kalshi-arb && cargo test -- --nocapture 2>&1`
Expected: All pass

**Step 5: Commit**

```bash
cd kalshi-arb && git add config.toml src/config.rs
git commit -m "refactor(config): rewrite config.toml to per-sport pipeline format"
```

---

## Task 3: Create pipeline.rs — types and SignalTrace

**Files:**
- Create: `kalshi-arb/src/pipeline.rs`
- Modify: `kalshi-arb/src/main.rs` (add `mod pipeline;`)

Define the core types without the `tick()` implementation yet. This task is just the data structures.

**Step 1: Write pipeline.rs with types**

```rust
use crate::config::{MomentumConfig, StrategyConfig};
use crate::engine::momentum::{BookPressureTracker, VelocityTracker};
use crate::engine::strategy::{StrategySignal, TradeAction};
use crate::engine::win_prob::WinProbTable;
use crate::feed::score_feed::{ScorePoller, ScoreUpdate};
use crate::feed::types::OddsUpdate;
use crate::tui::state::{DiagnosticRow, MarketRow};
use std::collections::HashMap;
use std::time::Instant;

/// How this sport computes fair value.
pub enum FairValueSource {
    /// Live score data → win probability model → fair value in cents.
    ScoreFeed {
        poller: ScorePoller,
        win_prob: WinProbTable,
        regulation_secs: u16,
    },
    /// Sportsbook odds → devig → fair value in cents.
    OddsFeed,
}

/// What method produced a fair value.
#[derive(Debug, Clone)]
pub enum FairValueMethod {
    ScoreFeed { source: String },
    OddsFeed { source: String },
}

/// Raw inputs that led to a fair value calculation.
#[derive(Debug, Clone)]
pub enum FairValueInputs {
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

/// Full provenance for a trade signal — carried by SimPosition.
#[derive(Debug, Clone)]
pub struct SignalTrace {
    pub sport: String,
    pub ticker: String,
    pub timestamp: Instant,
    pub fair_value_method: FairValueMethod,
    pub fair_value_cents: u32,
    pub inputs: FairValueInputs,
    pub best_bid: u32,
    pub best_ask: u32,
    pub edge: i32,
    pub action: String,
    pub net_profit_estimate: i32,
    pub quantity: u32,
    pub momentum_score: f64,
    pub momentum_gated: bool,
}

/// Per-sport pipeline that owns its config, polling state, and fair-value source.
pub struct SportPipeline {
    pub key: String,
    pub series: String,
    pub label: String,
    pub hotkey: char,
    pub enabled: bool,

    pub fair_value_source: FairValueSource,
    pub odds_source: String,

    // Resolved config (sport override merged over global)
    pub strategy_config: StrategyConfig,
    pub momentum_config: MomentumConfig,

    // Polling state
    pub last_odds_poll: Option<Instant>,
    pub last_score_poll: Option<Instant>,
    pub cached_odds: Vec<OddsUpdate>,
    pub cached_scores: Vec<ScoreUpdate>,
    pub last_score_fetch: HashMap<String, Instant>,
    pub diagnostic_rows: Vec<DiagnosticRow>,
    pub commence_times: Vec<String>,
    pub force_score_refetch: bool,

    // Per-event trackers
    pub velocity_trackers: HashMap<String, VelocityTracker>,
    pub book_pressure_trackers: HashMap<String, BookPressureTracker>,
}

/// Results from one pipeline tick.
pub struct TickResult {
    pub filter_live: usize,
    pub filter_pre_game: usize,
    pub filter_closed: usize,
    pub earliest_commence: Option<chrono::DateTime<chrono::Utc>>,
    pub rows: HashMap<String, MarketRow>,
    pub has_live_games: bool,
}
```

**Step 2: Add `mod pipeline;` to main.rs**

Add `mod pipeline;` after the other `mod` declarations at the top of `main.rs` (line 5).

**Step 3: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: No errors (types only, no logic yet)

**Step 4: Commit**

```bash
cd kalshi-arb && git add src/pipeline.rs src/main.rs
git commit -m "feat(pipeline): add SportPipeline types and SignalTrace"
```

---

## Task 4: Add SignalTrace to SimPosition and TradeRow

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs`

**Step 1: Add SignalTrace field to SimPosition**

In `tui/state.rs`, add `pub trace: Option<crate::pipeline::SignalTrace>` to `SimPosition`:

```rust
pub struct SimPosition {
    pub ticker: String,
    pub quantity: u32,
    pub entry_price: u32,
    pub sell_price: u32,
    pub entry_fee: u32,
    pub filled_at: Instant,
    pub signal_ask: u32,
    pub trace: Option<crate::pipeline::SignalTrace>,
}
```

**Step 2: Add source field to TradeRow**

Add `pub source: String` to `TradeRow` and `pub fair_value_basis: String`:

```rust
pub struct TradeRow {
    pub time: String,
    pub action: String,
    pub ticker: String,
    pub price: u32,
    pub quantity: u32,
    pub order_type: String,
    pub pnl: Option<i32>,
    pub slippage: Option<i32>,
    pub source: String,
    pub fair_value_basis: String,
}
```

**Step 3: Fix all construction sites**

Every place that creates a `SimPosition` or `TradeRow` needs the new fields. For now, set `trace: None`, `source: String::new()`, `fair_value_basis: String::new()`. These will be populated when the pipeline is wired in Task 6.

Search for all construction sites:
- `SimPosition` created in `evaluate_matched_market()` in `main.rs` (~line 465)
- `TradeRow` created in `evaluate_matched_market()` (~line 474) and in the sim position close logic
- `TradeRow` may also be created in position exit logic — search for `push_trade`

**Step 4: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: No errors

**Step 5: Run tests**

Run: `cd kalshi-arb && cargo test 2>&1`
Expected: All pass

**Step 6: Commit**

```bash
cd kalshi-arb && git add src/tui/state.rs src/main.rs
git commit -m "feat(trace): add SignalTrace to SimPosition and source to TradeRow"
```

---

## Task 5: Build SportPipeline construction from config

**Files:**
- Modify: `kalshi-arb/src/pipeline.rs`

Add a `SportPipeline::from_config()` constructor that takes a sport key, `SportConfig`, global configs, and builds the pipeline with resolved overrides and the correct `FairValueSource`.

**Step 1: Write test for pipeline construction**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::*;

    fn test_global_strategy() -> StrategyConfig {
        StrategyConfig { taker_edge_threshold: 5, maker_edge_threshold: 2, min_edge_after_fees: 1 }
    }

    fn test_global_momentum() -> MomentumConfig {
        MomentumConfig {
            taker_momentum_threshold: 75, maker_momentum_threshold: 40,
            cancel_threshold: 30, velocity_weight: 0.6, book_pressure_weight: 0.4,
            velocity_window_size: 10, cancel_check_interval_ms: 1000,
            bypass_for_score_signals: false,
        }
    }

    #[test]
    fn test_odds_feed_pipeline_uses_global_defaults() {
        let sport_config = SportConfig {
            enabled: true, kalshi_series: "KXNHLGAME".into(),
            label: "NHL".into(), hotkey: "4".into(),
            fair_value: "odds-feed".into(), odds_source: "the-odds-api".into(),
            score_feed: None, win_prob: None, strategy: None, momentum: None,
        };
        let pipe = SportPipeline::from_config(
            "ice-hockey", &sport_config, &test_global_strategy(), &test_global_momentum(),
        );
        assert_eq!(pipe.strategy_config.taker_edge_threshold, 5);
        assert_eq!(pipe.momentum_config.taker_momentum_threshold, 75);
        assert!(matches!(pipe.fair_value_source, FairValueSource::OddsFeed));
    }

    #[test]
    fn test_score_feed_pipeline_with_overrides() {
        let sport_config = SportConfig {
            enabled: true, kalshi_series: "KXNBAGAME".into(),
            label: "NBA".into(), hotkey: "1".into(),
            fair_value: "score-feed".into(), odds_source: "the-odds-api".into(),
            score_feed: Some(ScoreFeedConfig {
                primary_url: "https://cdn.nba.com/test".into(),
                fallback_url: Some("https://espn.com/test".into()),
                live_poll_s: 1, pre_game_poll_s: 60,
                failover_threshold: 3, request_timeout_ms: 5000,
            }),
            win_prob: Some(WinProbConfig {
                home_advantage: 2.5, k_start: 0.065, k_range: 0.25,
                ot_k_start: 0.10, ot_k_range: 1.0, regulation_secs: Some(2880),
            }),
            strategy: Some(StrategyOverride {
                taker_edge_threshold: Some(3), maker_edge_threshold: Some(1),
                min_edge_after_fees: None,
            }),
            momentum: Some(MomentumOverride {
                taker_momentum_threshold: Some(0), maker_momentum_threshold: Some(0),
                cancel_threshold: None, velocity_weight: None, book_pressure_weight: None,
                velocity_window_size: None, cancel_check_interval_ms: None,
            }),
        };
        let pipe = SportPipeline::from_config(
            "basketball", &sport_config, &test_global_strategy(), &test_global_momentum(),
        );
        assert_eq!(pipe.strategy_config.taker_edge_threshold, 3);
        assert_eq!(pipe.strategy_config.min_edge_after_fees, 1); // inherited
        assert_eq!(pipe.momentum_config.taker_momentum_threshold, 0);
        assert!(matches!(pipe.fair_value_source, FairValueSource::ScoreFeed { .. }));
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd kalshi-arb && cargo test pipeline::tests -- --nocapture 2>&1`
Expected: Fail — `from_config` doesn't exist

**Step 3: Implement `from_config`**

```rust
impl SportPipeline {
    pub fn from_config(
        key: &str,
        sport: &crate::config::SportConfig,
        global_strategy: &StrategyConfig,
        global_momentum: &MomentumConfig,
    ) -> Self {
        let fair_value_source = match sport.fair_value.as_str() {
            "score-feed" => {
                let sf = sport.score_feed.as_ref()
                    .expect(&format!("sport '{}' has fair_value=score-feed but no [score_feed] section", key));
                let wp_config = sport.win_prob.as_ref()
                    .expect(&format!("sport '{}' has fair_value=score-feed but no [win_prob] section", key));
                let regulation_secs = wp_config.regulation_secs.unwrap_or(2880);
                let poller = if let Some(ref fallback) = sf.fallback_url {
                    ScorePoller::new(
                        &sf.primary_url, fallback,
                        sf.request_timeout_ms, sf.failover_threshold,
                    )
                } else {
                    // Single-source poller: use primary as both (fallback never triggered)
                    ScorePoller::new(
                        &sf.primary_url, &sf.primary_url,
                        sf.request_timeout_ms, sf.failover_threshold,
                    )
                };
                FairValueSource::ScoreFeed {
                    poller,
                    win_prob: WinProbTable::from_config(wp_config),
                    regulation_secs,
                }
            }
            _ => FairValueSource::OddsFeed,
        };

        let hotkey = sport.hotkey.chars().next().unwrap_or('0');

        SportPipeline {
            key: key.to_string(),
            series: sport.kalshi_series.clone(),
            label: sport.label.clone(),
            hotkey,
            enabled: sport.enabled,
            fair_value_source,
            odds_source: sport.odds_source.clone(),
            strategy_config: global_strategy.with_override(sport.strategy.as_ref()),
            momentum_config: global_momentum.with_override(sport.momentum.as_ref()),
            last_odds_poll: None,
            last_score_poll: None,
            cached_odds: Vec::new(),
            cached_scores: Vec::new(),
            last_score_fetch: HashMap::new(),
            diagnostic_rows: Vec::new(),
            commence_times: Vec::new(),
            force_score_refetch: false,
            velocity_trackers: HashMap::new(),
            book_pressure_trackers: HashMap::new(),
        }
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd kalshi-arb && cargo test pipeline::tests -- --nocapture 2>&1`
Expected: PASS

**Step 5: Commit**

```bash
cd kalshi-arb && git add src/pipeline.rs
git commit -m "feat(pipeline): add SportPipeline::from_config constructor"
```

---

## Task 6: Implement SportPipeline::tick() for OddsFeed pipelines

**Files:**
- Modify: `kalshi-arb/src/pipeline.rs`

This is the largest task. Extract the logic from `main.rs` lines 1500-1641 (the `for sport in &odds_sports` loop) into `SportPipeline::tick()`.

The method needs access to shared mutable state (odds sources, live book, state sender). Pass these as parameters.

**Step 1: Define the tick signature**

```rust
impl SportPipeline {
    pub async fn tick(
        &mut self,
        cycle_start: Instant,
        market_index: &crate::engine::matcher::MarketIndex,
        live_book: &crate::LiveBook,
        odds_sources: &mut HashMap<String, Box<dyn crate::feed::OddsFeed>>,
        scorer: &crate::engine::momentum::MomentumScorer,
        risk_config: &crate::config::RiskConfig,
        sim_config: &crate::config::SimulationConfig,
        sim_mode: bool,
        state_tx: &tokio::sync::watch::Sender<crate::tui::state::AppState>,
        bankroll_cents: u64,
    ) -> TickResult
```

**Step 2: Implement tick() for OddsFeed variant**

Move the body of the odds-feed processing loop from `main.rs` into `tick()`. The key changes:
- Use `self.odds_source` to get the feed from `odds_sources` HashMap
- Use `self.strategy_config` and `self.momentum_config` instead of the global ones
- Use `self.velocity_trackers` and `self.book_pressure_trackers` instead of shared maps
- Use `self.cached_odds`, `self.last_odds_poll`, `self.commence_times`, `self.diagnostic_rows`
- Call the existing `evaluate_matched_market()` function (move it to pipeline.rs or keep it in main.rs as a free function and make it `pub`)
- The `build_diagnostic_rows()` function should also move to pipeline.rs or become pub

The `evaluate_matched_market` function from `main.rs` (lines 304-493) and `build_diagnostic_rows` (lines 194-289) should be moved to `pipeline.rs` since they're the core of the pipeline. Make them methods or associated functions.

**Step 3: Implement tick() for ScoreFeed variant**

Move score-feed processing from `main.rs` (lines 1356-1498). The key differences:
- Fair value comes from `WinProbTable::fair_value()` not devigging
- Polling uses score feed intervals
- The overtime detection uses `regulation_secs` from the pipeline

**Step 4: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: Compiles (main.rs still has old code — that's OK, we'll clean it up in Task 7)

**Step 5: Commit**

```bash
cd kalshi-arb && git add src/pipeline.rs src/main.rs
git commit -m "feat(pipeline): implement tick() for OddsFeed and ScoreFeed pipelines"
```

---

## Task 7: Rewrite main.rs event loop to use pipelines

**Files:**
- Modify: `kalshi-arb/src/main.rs`

This is the big payoff. Replace the ~800-line event loop with the pipeline iteration.

**Step 1: Replace Phase 3 (odds feed construction)**

Replace lines ~1040-1160 with:

```rust
// Build shared odds sources
let mut odds_sources: HashMap<String, Box<dyn OddsFeed>> = HashMap::new();
for (name, source_config) in &config.odds_sources {
    match source_config.source_type.as_str() {
        "the-odds-api" => {
            let key = odds_api_key.clone().expect("odds API key required");
            let base_url = source_config.base_url.as_deref().unwrap_or("https://api.the-odds-api.com");
            let bookmakers = source_config.bookmakers.as_deref().unwrap_or("draftkings,fanduel,betmgm,caesars");
            odds_sources.insert(name.clone(), Box::new(TheOddsApi::new(key, base_url, bookmakers)));
        }
        "draftkings" => {
            let dk_config = config::DraftKingsFeedConfig {
                live_poll_interval_s: source_config.live_poll_s,
                pre_game_poll_interval_s: source_config.pre_game_poll_s,
                request_timeout_ms: source_config.request_timeout_ms,
            };
            odds_sources.insert(name.clone(), Box::new(DraftKingsFeed::new(&dk_config)));
        }
        other => {
            eprintln!("Unknown odds source type: {}", other);
            std::process::exit(1);
        }
    }
}
```

Note: `DraftKingsFeedConfig` is still needed internally by `DraftKingsFeed::new()`. Keep it as an internal type or adapt `DraftKingsFeed::new()` to take the raw values directly. The simplest path: keep `DraftKingsFeedConfig` in config.rs but don't expose it in the TOML schema — construct it in main.rs from `OddsSourceConfig` fields.

**Step 2: Build pipelines from config**

```rust
// Build per-sport pipelines
let mut sport_pipelines: Vec<SportPipeline> = Vec::new();
// Sort by hotkey for consistent ordering
let mut sport_entries: Vec<_> = config.sports.iter().collect();
sport_entries.sort_by_key(|(_, sc)| sc.hotkey.clone());

for (key, sport_config) in &sport_entries {
    let pipeline = SportPipeline::from_config(
        key, sport_config, &config.strategy, &config.momentum,
    );
    sport_pipelines.push(pipeline);
}
```

**Step 3: Replace the event loop body**

The loop body (~lines 1262-1870) becomes:

```rust
loop {
    // Drain TUI commands
    while let Ok(cmd) = cmd_rx.try_recv() {
        match cmd {
            TuiCommand::Pause => { is_paused = true; state_tx.send_modify(|s| s.is_paused = true); }
            TuiCommand::Resume => { is_paused = false; state_tx.send_modify(|s| s.is_paused = false); }
            TuiCommand::Quit => return,
            TuiCommand::ToggleSport(sport_key) => {
                if let Some(pipe) = sport_pipelines.iter_mut().find(|p| p.key == sport_key) {
                    pipe.enabled = !pipe.enabled;
                    // persist to config.toml
                    persist_sport_enabled(&config_path, &sport_key, pipe.enabled);
                }
            }
            TuiCommand::FetchDiagnostic => {
                // handled per-pipeline below
            }
        }
    }

    if is_paused {
        tokio::time::sleep(Duration::from_secs(1)).await;
        continue;
    }

    let cycle_start = Instant::now();
    let mut accumulated_rows: HashMap<String, MarketRow> = HashMap::new();
    let mut filter_live = 0usize;
    let mut filter_pre_game = 0usize;
    let mut filter_closed = 0usize;
    let mut earliest_commence: Option<chrono::DateTime<chrono::Utc>> = None;

    let bankroll_cents = {
        let s = state_tx.borrow();
        if sim_mode { s.sim_balance_cents.max(0) as u64 } else { s.balance_cents.max(0) as u64 }
    };

    for pipeline in &mut sport_pipelines {
        if !pipeline.enabled { continue; }

        let result = pipeline.tick(
            cycle_start, &market_index, &live_book, &mut odds_sources,
            &scorer, &risk_config, &sim_config, sim_mode, &state_tx, bankroll_cents,
        ).await;

        filter_live += result.filter_live;
        filter_pre_game += result.filter_pre_game;
        filter_closed += result.filter_closed;
        if let Some(ec) = result.earliest_commence {
            earliest_commence = Some(earliest_commence.map_or(ec, |e| e.min(ec)));
        }
        accumulated_rows.extend(result.rows);
    }

    // Sort rows, update TUI, idle sleep (same as before but much shorter)
    // ...
}
```

**Step 4: Remove dead code**

Delete from `main.rs`:
- `SPORT_REGISTRY` const
- `EnabledSports` struct and impl
- `SportProcessResult` struct
- `process_sport_updates()` function
- `process_score_updates()` function
- `process_college_score_updates()` function
- `build_diagnostic_rows()` function (moved to pipeline.rs)
- `evaluate_matched_market()` function (moved to pipeline.rs)
- `EvalOutcome` enum (moved to pipeline.rs)
- `fetch_odds!` macro
- All the loose `HashMap` state variables (velocity_trackers, book_pressure_trackers, etc.)

Keep:
- `DepthBook` and `LiveBook` type alias
- `last_name()` helper (used by matcher for MMA)
- Auth/startup logic
- Kalshi market fetching
- WS spawn
- TUI spawn
- Idle sleep logic (simplified — just check `pipeline.has_live_games` from TickResult)

**Step 5: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: Compiles

**Step 6: Run all tests**

Run: `cd kalshi-arb && cargo test 2>&1`
Expected: All pass (engine tests, feed tests, tui tests unchanged)

**Step 7: Commit**

```bash
cd kalshi-arb && git add src/main.rs src/pipeline.rs
git commit -m "refactor(main): replace 800-line event loop with pipeline iteration"
```

---

## Task 8: Wire SignalTrace into simulation fills

**Files:**
- Modify: `kalshi-arb/src/pipeline.rs` (in `evaluate_matched_market`)

Now that the pipeline is the evaluation entry point, build `SignalTrace` at signal time and attach it to `SimPosition`.

**Step 1: Build SignalTrace in evaluate_matched_market**

After computing the signal and before the sim-fill block, construct:

```rust
let trace = SignalTrace {
    sport: self.key.clone(),
    ticker: ticker.to_string(),
    timestamp: Instant::now(),
    fair_value_method: fair_value_method.clone(), // passed in from tick()
    fair_value_cents: fair,
    inputs: fair_value_inputs.clone(),            // passed in from tick()
    best_bid: bid,
    best_ask: ask,
    edge: signal.edge,
    action: action_str.to_string(),
    net_profit_estimate: signal.net_profit_estimate,
    quantity: signal.quantity,
    momentum_score: momentum,
    momentum_gated: !bypass_momentum && original_action != action_str,
};
```

Pass `Some(trace)` when constructing `SimPosition`.

**Step 2: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`

**Step 3: Run tests**

Run: `cd kalshi-arb && cargo test 2>&1`

**Step 4: Commit**

```bash
cd kalshi-arb && git add src/pipeline.rs
git commit -m "feat(trace): wire SignalTrace into simulation fills"
```

---

## Task 9: Update TUI trade view to show signal provenance

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs`

**Step 1: Add source and basis columns to the sim position table**

In the position rendering section, add columns for "Source" and "Basis":
- Source: from `trace.fair_value_method` — display "score-feed" or "odds-api"
- Basis: from `trace.inputs` — format as:
  - Score: `"LAL 78-71 Q3 4:32 (wp=0.68)"`
  - Odds: `"devig: -180/+155 (p=0.64)"`

**Step 2: Add source column to trade history table**

The `TradeRow.source` field is now populated. Add a "SRC" column to the trade table header and row rendering.

**Step 3: Verify it compiles and renders correctly**

Run: `cd kalshi-arb && cargo check 2>&1`
Run: `cd kalshi-arb && cargo test 2>&1`

**Step 4: Commit**

```bash
cd kalshi-arb && git add src/tui/render.rs
git commit -m "feat(tui): show signal provenance in trade and position views"
```

---

## Task 10: Add config TUI view — state and command plumbing

**Files:**
- Create: `kalshi-arb/src/tui/config_view.rs`
- Modify: `kalshi-arb/src/tui/mod.rs`
- Modify: `kalshi-arb/src/tui/state.rs`

**Step 1: Define ConfigView state**

In `tui/config_view.rs`:

```rust
#[derive(Debug, Clone)]
pub struct ConfigField {
    pub label: String,
    pub value: String,
    pub field_type: FieldType,
    pub is_override: bool,      // differs from global default
    pub config_path: String,    // TOML dotted path for persistence
}

#[derive(Debug, Clone)]
pub enum FieldType {
    U8,
    U16,
    U32,
    U64,
    F64,
    Bool,
    String,
}

#[derive(Debug, Clone)]
pub struct ConfigTab {
    pub label: String,
    pub sport_key: Option<String>,  // None for Global tab
    pub fields: Vec<ConfigField>,
}

#[derive(Debug)]
pub struct ConfigViewState {
    pub tabs: Vec<ConfigTab>,
    pub active_tab: usize,
    pub selected_field: usize,
    pub editing: bool,
    pub edit_buffer: String,
}
```

**Step 2: Add config_focus to AppState**

In `tui/state.rs`, add:

```rust
pub config_focus: bool,
pub config_view: Option<crate::tui::config_view::ConfigViewState>,
```

**Step 3: Add TuiCommand variants**

In `tui/mod.rs`, add to `TuiCommand`:

```rust
OpenConfig,
CloseConfig,
UpdateConfig { sport_key: Option<String>, field_path: String, value: String },
```

**Step 4: Add `c` hotkey handler**

In `tui/mod.rs`, in the global key handler (the `else` branch at ~line 250), add:

```rust
KeyCode::Char('c') => {
    config_focus = true;
    // Build config view state from current AppState
    let _ = cmd_tx.send(TuiCommand::OpenConfig).await;
}
```

**Step 5: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`

**Step 6: Commit**

```bash
cd kalshi-arb && git add src/tui/config_view.rs src/tui/mod.rs src/tui/state.rs
git commit -m "feat(tui): add config view state, commands, and hotkey plumbing"
```

---

## Task 11: Build ConfigTab data from pipelines

**Files:**
- Modify: `kalshi-arb/src/tui/config_view.rs`
- Modify: `kalshi-arb/src/pipeline.rs`

**Step 1: Add `build_config_tabs` function**

In `config_view.rs`, add a function that takes the list of `SportPipeline`s and global config, and builds `Vec<ConfigTab>`:

```rust
pub fn build_config_tabs(
    pipelines: &[crate::pipeline::SportPipeline],
    global_strategy: &crate::config::StrategyConfig,
    global_momentum: &crate::config::MomentumConfig,
    risk: &crate::config::RiskConfig,
    sim: &crate::config::SimulationConfig,
) -> Vec<ConfigTab>
```

For each pipeline, build a `ConfigTab` with:
- Pipeline header fields (fair_value, odds_source, kalshi_series) as read-only
- Score feed fields (if score-feed pipeline) — editable
- Win prob fields (if score-feed pipeline) — editable
- Strategy fields with override detection (compare to global)
- Momentum fields with override detection

Add a "Global" tab with strategy, risk, momentum, simulation fields.

**Step 2: Test tab building**

Write a test that constructs pipelines and verifies the correct number of tabs and fields are generated.

**Step 3: Verify**

Run: `cd kalshi-arb && cargo test 2>&1`

**Step 4: Commit**

```bash
cd kalshi-arb && git add src/tui/config_view.rs src/pipeline.rs
git commit -m "feat(config-view): build config tabs from pipeline state"
```

---

## Task 12: Render config view

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs`

**Step 1: Add `render_config` function**

In `render.rs`, add a function that draws the config view when `config_focus` is true:

```rust
fn render_config(f: &mut Frame, state: &AppState)
```

Layout:
- Top bar: tab labels, active tab highlighted
- Body: two-column layout (left: pipeline info + source-specific fields, right: strategy + momentum)
- Bottom: keybinding hints
- Editable fields shown with `[value]` brackets
- Override fields in yellow (`Style::default().fg(Color::Yellow)`)
- Currently selected field with cursor highlight
- Edit mode: field value replaced with edit buffer + cursor

**Step 2: Wire into main `draw()` function**

At the top of `draw()`, check `state.config_focus` — if true, call `render_config()` and return early (full-screen takeover).

**Step 3: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`

**Step 4: Commit**

```bash
cd kalshi-arb && git add src/tui/render.rs
git commit -m "feat(tui): render config view with tabs, fields, and override highlights"
```

---

## Task 13: Config view keyboard navigation and editing

**Files:**
- Modify: `kalshi-arb/src/tui/mod.rs`

**Step 1: Add config view key handlers**

When `config_focus` is true, handle:
- `Left` / `Right`: change active tab
- `Up` / `Down` / `j` / `k`: navigate fields
- `Enter`: enter edit mode (set `editing = true`, populate `edit_buffer`)
- In edit mode: character input appends to buffer, `Backspace` removes, `Enter` confirms (sends `TuiCommand::UpdateConfig`), `Esc` cancels
- `d`: delete override (revert field to global default)
- `Space` on enabled field: toggle enabled
- `Esc` (not in edit mode): exit config view (`config_focus = false`)

**Step 2: Handle UpdateConfig in main.rs engine loop**

When `TuiCommand::UpdateConfig` is received:
1. Find the pipeline by sport_key (or global config if None)
2. Update the field value
3. Persist to config.toml using TOML manipulation (same pattern as `EnabledSports::persist()`)

**Step 3: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`

**Step 4: Manual testing**

Run: `cd kalshi-arb && cargo run -- --simulate 2>&1`
- Press `c` — config view opens
- Navigate tabs with Left/Right
- Navigate fields with Up/Down
- Press Enter, type a value, press Enter — field updates
- Press Esc — config view closes
- Verify `config.toml` reflects changes

**Step 5: Commit**

```bash
cd kalshi-arb && git add src/tui/mod.rs src/main.rs
git commit -m "feat(tui): config view keyboard navigation and live editing"
```

---

## Task 14: Config persistence for runtime edits

**Files:**
- Modify: `kalshi-arb/src/config.rs`

**Step 1: Add `persist_field` function**

```rust
pub fn persist_field(config_path: &Path, dotted_key: &str, value: &str) -> Result<()>
```

This parses the existing TOML, navigates to the dotted key path (e.g. `"sports.basketball.strategy.taker_edge_threshold"`), updates the value, and writes back.

Use `toml::Value` manipulation (same pattern as the existing `EnabledSports::persist()`).

**Step 2: Add `remove_field` for deleting overrides**

```rust
pub fn remove_field(config_path: &Path, dotted_key: &str) -> Result<()>
```

Removes the key from the TOML file so the global default applies.

**Step 3: Write tests**

```rust
#[test]
fn test_persist_field_roundtrip() {
    // Write a temp config, persist a field, read back, verify
}
```

**Step 4: Run tests**

Run: `cd kalshi-arb && cargo test 2>&1`

**Step 5: Commit**

```bash
cd kalshi-arb && git add src/config.rs
git commit -m "feat(config): add persist_field and remove_field for runtime TOML edits"
```

---

## Task 15: Final cleanup and test sweep

**Files:**
- Modify: `kalshi-arb/src/main.rs` (remove any remaining dead code)
- Modify: `kalshi-arb/src/config.rs` (remove old test if still present)

**Step 1: Remove all dead code**

Search for unused imports, functions, and types:

Run: `cd kalshi-arb && cargo check 2>&1 | grep warning`

Fix all warnings.

**Step 2: Run full test suite**

Run: `cd kalshi-arb && cargo test 2>&1`
Expected: All pass, 0 warnings

**Step 3: Run clippy**

Run: `cd kalshi-arb && cargo clippy 2>&1`
Fix any lint issues.

**Step 4: Build Windows executable**

Run: `cd kalshi-arb && cargo build --release --target x86_64-pc-windows-gnu && cp target/x86_64-pc-windows-gnu/release/kalshi-arb.exe kalshi-arb.exe`

**Step 5: Final commit**

```bash
cd kalshi-arb && git add -A
git commit -m "refactor: complete per-sport pipeline refactor with config TUI

- Config restructured: per-sport pipeline declarations with explicit
  fair_value source, odds_source, strategy/momentum overrides
- Main loop reduced from ~800 lines to ~50 lines
- SignalTrace carried by every sim trade for full provenance
- Trade/position views show source and fair value basis
- Config TUI view (c hotkey): tabbed editor with live persistence
- Eliminated: SPORT_REGISTRY, EnabledSports, fetch_odds! macro,
  bypass_for_score_signals, 10+ loose HashMaps"
```
