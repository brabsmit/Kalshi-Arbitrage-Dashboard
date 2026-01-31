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
                    .unwrap_or_else(|| panic!("sport '{}' has fair_value=score-feed but no [score_feed] section", key));
                let wp_config = sport.win_prob.as_ref()
                    .unwrap_or_else(|| panic!("sport '{}' has fair_value=score-feed but no [win_prob] section", key));
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

/// Results from one pipeline tick.
pub struct TickResult {
    pub filter_live: usize,
    pub filter_pre_game: usize,
    pub filter_closed: usize,
    pub earliest_commence: Option<chrono::DateTime<chrono::Utc>>,
    pub rows: HashMap<String, MarketRow>,
    pub has_live_games: bool,
}

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
