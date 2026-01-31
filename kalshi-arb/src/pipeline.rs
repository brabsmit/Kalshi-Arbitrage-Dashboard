use crate::config::{MomentumConfig, StrategyConfig};
use crate::engine::momentum::{BookPressureTracker, VelocityTracker};
use crate::engine::win_prob::WinProbTable;
use crate::feed::score_feed::{ScorePoller, ScoreUpdate};
use crate::feed::types::OddsUpdate;
use crate::tui::state::{DiagnosticRow, MarketRow};
use std::collections::HashMap;
use std::time::Instant;

/// How this sport computes fair value.
pub enum FairValueSource {
    /// Live score data -> win probability model -> fair value in cents.
    ScoreFeed {
        poller: ScorePoller,
        win_prob: WinProbTable,
        regulation_secs: u16,
    },
    /// Sportsbook odds -> devig -> fair value in cents.
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
