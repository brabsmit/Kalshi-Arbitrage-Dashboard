use crate::config::{
    MomentumConfig, OddsSourceConfig, ScoreFeedConfig, StrategyConfig, WinProbConfig,
};
use crate::engine::fees::calculate_fee;
use crate::engine::momentum::{BookPressureTracker, MomentumScorer, VelocityTracker};
use crate::engine::win_prob::WinProbTable;
use crate::engine::{matcher, strategy};
use crate::feed::score_feed::{ScorePoller, ScoreUpdate};
use crate::feed::types::OddsUpdate;
use crate::feed::OddsFeed;
use crate::tui::state::{AppState, DiagnosticRow, MarketRow};
use crate::LiveBook;
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};
use tokio::sync::watch;

/// How this sport computes fair value.
pub enum FairValueSource {
    /// Live score data -> win probability model -> fair value in cents.
    ScoreFeed {
        poller: Box<ScorePoller>,
        win_prob: WinProbTable,
        regulation_secs: u16,
        live_poll_s: u64,
        pre_game_poll_s: u64,
    },
    /// Sportsbook odds -> devig -> fair value in cents.
    OddsFeed,
}

/// What method produced a fair value.
#[derive(Debug, Clone)]
pub enum FairValueMethod {
    ScoreFeed {
        #[allow(dead_code)]
        source: String,
    },
    OddsFeed {
        #[allow(dead_code)]
        source: String,
    },
}

/// Raw inputs that led to a fair value calculation.
#[derive(Debug, Clone)]
#[allow(dead_code)]
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

/// Full provenance for a trade signal -- carried by SimPosition.
#[derive(Debug, Clone)]
#[allow(dead_code)]
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
    pub score_feed_config: Option<ScoreFeedConfig>,
    pub win_prob_config: Option<WinProbConfig>,

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

fn build_fair_value_source(
    key: &str,
    fair_value_str: &str,
    score_feed_config: Option<&ScoreFeedConfig>,
    win_prob_config: Option<&WinProbConfig>,
) -> FairValueSource {
    match fair_value_str {
        "score-feed" => {
            let sf = score_feed_config.unwrap_or_else(|| {
                panic!(
                    "sport '{}' has fair_value=score-feed but no [score_feed] section",
                    key
                )
            });
            let wp_config = win_prob_config.unwrap_or_else(|| {
                panic!(
                    "sport '{}' has fair_value=score-feed but no [win_prob] section",
                    key
                )
            });
            let regulation_secs = wp_config.regulation_secs.unwrap_or(2880);
            let poller = if let Some(ref fallback) = sf.fallback_url {
                ScorePoller::new(
                    &sf.primary_url,
                    fallback,
                    sf.request_timeout_ms,
                    sf.failover_threshold,
                )
            } else {
                ScorePoller::new(
                    &sf.primary_url,
                    &sf.primary_url,
                    sf.request_timeout_ms,
                    sf.failover_threshold,
                )
            };
            FairValueSource::ScoreFeed {
                poller: Box::new(poller),
                win_prob: WinProbTable::from_config(wp_config),
                regulation_secs,
                live_poll_s: sf.live_poll_s,
                pre_game_poll_s: sf.pre_game_poll_s,
            }
        }
        // Everything else is treated as an odds source (the-odds-api, scraped-bovada, etc.)
        _ => FairValueSource::OddsFeed,
    }
}

impl SportPipeline {
    pub fn from_config(
        key: &str,
        sport: &crate::config::SportConfig,
        global_strategy: &StrategyConfig,
        global_momentum: &MomentumConfig,
    ) -> Self {
        let score_feed_config = sport.score_feed.clone();
        let win_prob_config = sport.win_prob.clone();
        let fair_value_source = build_fair_value_source(
            key,
            &sport.fair_value,
            score_feed_config.as_ref(),
            win_prob_config.as_ref(),
        );

        let hotkey = sport.hotkey.chars().next().unwrap_or('0');

        // If fair_value is an odds source name (not "score-feed"), use it as odds_source
        let odds_source = if sport.fair_value != "score-feed" && sport.fair_value != "odds-feed" {
            sport.fair_value.clone()
        } else {
            sport.odds_source.clone()
        };

        SportPipeline {
            key: key.to_string(),
            series: sport.kalshi_series.clone(),
            label: sport.label.clone(),
            hotkey,
            enabled: sport.enabled,
            fair_value_source,
            odds_source,
            score_feed_config,
            win_prob_config,
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

    /// Rebuild the fair value source at runtime (e.g. switching between score-feed and odds sources).
    /// If new_source is an odds source name (not "score-feed"), also updates odds_source field.
    pub fn rebuild_fair_value_source(&mut self, new_source: &str) {
        self.fair_value_source = build_fair_value_source(
            &self.key,
            new_source,
            self.score_feed_config.as_ref(),
            self.win_prob_config.as_ref(),
        );

        // If the new source is not "score-feed", it's an odds source name - update odds_source field
        if new_source != "score-feed" {
            self.odds_source = new_source.to_string();
        }
    }

    /// Run one processing cycle for this sport.
    #[allow(clippy::too_many_arguments)]
    pub async fn tick(
        &mut self,
        cycle_start: Instant,
        market_index: &matcher::MarketIndex,
        live_book: &LiveBook,
        odds_sources: &mut HashMap<String, Box<dyn OddsFeed>>,
        scorer: &MomentumScorer,
        risk_config: &crate::config::RiskConfig,
        sim_config: &crate::config::SimulationConfig,
        sim_mode: bool,
        state_tx: &watch::Sender<AppState>,
        bankroll_cents: u64,
        api_request_times: &mut VecDeque<Instant>,
        odds_source_configs: &HashMap<String, OddsSourceConfig>,
    ) -> TickResult {
        match &self.fair_value_source {
            FairValueSource::ScoreFeed {
                regulation_secs,
                live_poll_s,
                pre_game_poll_s,
                ..
            } => {
                let regulation_secs = *regulation_secs;
                let live_poll_s = *live_poll_s;
                let pre_game_poll_s = *pre_game_poll_s;
                self.tick_score_feed(
                    cycle_start,
                    market_index,
                    live_book,
                    odds_sources,
                    scorer,
                    risk_config,
                    sim_config,
                    sim_mode,
                    state_tx,
                    bankroll_cents,
                    regulation_secs,
                    live_poll_s,
                    pre_game_poll_s,
                    api_request_times,
                    odds_source_configs,
                )
                .await
            }
            FairValueSource::OddsFeed => {
                self.tick_odds_feed(
                    cycle_start,
                    market_index,
                    live_book,
                    odds_sources,
                    scorer,
                    risk_config,
                    sim_config,
                    sim_mode,
                    state_tx,
                    bankroll_cents,
                    api_request_times,
                    odds_source_configs,
                )
                .await
            }
        }
    }

    /// Score-feed pipeline tick: poll scores, compute fair value, evaluate.
    #[allow(clippy::too_many_arguments)]
    async fn tick_score_feed(
        &mut self,
        cycle_start: Instant,
        market_index: &matcher::MarketIndex,
        live_book: &LiveBook,
        odds_sources: &mut HashMap<String, Box<dyn OddsFeed>>,
        scorer: &MomentumScorer,
        risk_config: &crate::config::RiskConfig,
        sim_config: &crate::config::SimulationConfig,
        sim_mode: bool,
        state_tx: &watch::Sender<AppState>,
        bankroll_cents: u64,
        regulation_secs: u16,
        live_poll_s: u64,
        pre_game_poll_s: u64,
        api_request_times: &mut VecDeque<Instant>,
        odds_source_configs: &HashMap<String, OddsSourceConfig>,
    ) -> TickResult {
        // Poll odds feed for diagnostic rows (pre-game interval to avoid
        // burning API quota — the score feed drives actual fair value).
        // When validate_fair_value is on, use live_poll_s for faster updates.
        let diag_poll_s = odds_source_configs
            .get(&self.odds_source)
            .map(|c| {
                if sim_config.validate_fair_value {
                    c.live_poll_s
                } else {
                    c.pre_game_poll_s
                }
            })
            .unwrap_or(120);
        let should_fetch_odds = match self.last_odds_poll {
            Some(last) => cycle_start.duration_since(last) >= Duration::from_secs(diag_poll_s),
            None => true,
        };
        if should_fetch_odds {
            if let Some(source) = odds_sources.get_mut(&self.odds_source) {
                match source.fetch_odds(&self.key).await {
                    Ok(updates) => {
                        self.last_odds_poll = Some(Instant::now());
                        self.commence_times =
                            updates.iter().map(|u| u.commence_time.clone()).collect();
                        if let Some(quota) = source.last_quota() {
                            api_request_times.push_back(Instant::now());
                            let one_hour_ago = Instant::now() - Duration::from_secs(3600);
                            while api_request_times.front().is_some_and(|&t| t < one_hour_ago) {
                                api_request_times.pop_front();
                            }
                            let burn_rate = api_request_times.len() as f64;
                            state_tx.send_modify(|s| {
                                s.api_requests_used = quota.requests_used;
                                s.api_requests_remaining = quota.requests_remaining;
                                s.api_burn_rate = burn_rate;
                                s.api_hours_remaining = if burn_rate > 0.0 {
                                    quota.requests_remaining as f64 / burn_rate
                                } else {
                                    f64::INFINITY
                                };
                            });
                        }
                        let source_name = format_source_name(&self.odds_source);
                        self.diagnostic_rows =
                            build_diagnostic_rows(&updates, &self.key, market_index, &source_name);
                        self.cached_odds = updates;
                    }
                    Err(e) => {
                        tracing::warn!(sport = %self.key, error = %e, "diagnostic odds fetch failed");
                    }
                }
            }
        }

        // Determine poll interval from cached state
        let has_live = self
            .cached_scores
            .iter()
            .any(|u| u.game_status == crate::feed::score_feed::GameStatus::Live);

        let score_interval = if has_live {
            Duration::from_secs(live_poll_s)
        } else {
            Duration::from_secs(pre_game_poll_s)
        };

        let should_fetch = self.force_score_refetch
            || match self.last_score_poll {
                Some(last) => cycle_start.duration_since(last) >= score_interval,
                None => true,
            };

        if should_fetch {
            if let FairValueSource::ScoreFeed { ref mut poller, .. } = self.fair_value_source {
                self.force_score_refetch = false;
                match poller.fetch().await {
                    Ok(mut updates) => {
                        // For college sports (regulation_secs <= 2400), recompute
                        // elapsed with college period structure
                        if regulation_secs <= 2400 {
                            for u in &mut updates {
                                u.total_elapsed_seconds =
                                    ScoreUpdate::compute_elapsed_college(u.period, u.clock_seconds);
                            }
                        }
                        self.last_score_poll = Some(Instant::now());
                        for u in &updates {
                            self.last_score_fetch
                                .insert(u.game_id.clone(), Instant::now());
                        }
                        self.cached_scores = updates;
                    }
                    Err(e) => {
                        tracing::warn!(sport = %self.key, error = %e, "score feed fetch failed");
                    }
                }
            }
        }

        // Process cached scores
        if self.cached_scores.is_empty() {
            return TickResult {
                filter_live: 0,
                filter_pre_game: 0,
                filter_closed: 0,
                earliest_commence: None,
                rows: HashMap::new(),
                has_live_games: false,
                closed_tickers: Vec::new(),
                order_intents: Vec::new(),
            };
        }

        process_score_updates(
            &self.cached_scores,
            &self.key,
            regulation_secs,
            market_index,
            live_book,
            &self.strategy_config,
            &self.momentum_config,
            &mut self.velocity_trackers,
            &mut self.book_pressure_trackers,
            scorer,
            sim_mode,
            state_tx,
            cycle_start,
            &self.last_score_fetch,
            sim_config,
            &self.fair_value_source,
            risk_config,
            bankroll_cents,
            if sim_config.validate_fair_value {
                &self.cached_odds
            } else {
                &[]
            },
        )
    }

    /// Odds-feed pipeline tick: poll odds, build diagnostic rows, evaluate.
    #[allow(clippy::too_many_arguments)]
    async fn tick_odds_feed(
        &mut self,
        cycle_start: Instant,
        market_index: &matcher::MarketIndex,
        live_book: &LiveBook,
        odds_sources: &mut HashMap<String, Box<dyn OddsFeed>>,
        scorer: &MomentumScorer,
        risk_config: &crate::config::RiskConfig,
        sim_config: &crate::config::SimulationConfig,
        sim_mode: bool,
        state_tx: &watch::Sender<AppState>,
        bankroll_cents: u64,
        api_request_times: &mut VecDeque<Instant>,
        odds_source_configs: &HashMap<String, OddsSourceConfig>,
    ) -> TickResult {
        // Determine if any event is live (from commence times)
        let is_live = self.commence_times.iter().any(|ct| {
            chrono::DateTime::parse_from_rfc3339(ct)
                .ok()
                .is_some_and(|dt| dt < chrono::Utc::now())
        });

        // Determine polling intervals from the odds source config
        let source_config = odds_source_configs.get(&self.odds_source);
        let live_poll_s = source_config.map(|c| c.live_poll_s).unwrap_or(20);
        let pre_game_poll_s = source_config.map(|c| c.pre_game_poll_s).unwrap_or(120);
        let quota_warning = source_config
            .and_then(|c| c.quota_warning_threshold)
            .unwrap_or(100);

        let quota_low = !api_request_times.is_empty()
            && state_tx.borrow().api_requests_remaining < quota_warning;
        let interval = if quota_low || !is_live {
            Duration::from_secs(pre_game_poll_s)
        } else {
            Duration::from_secs(live_poll_s)
        };

        let should_fetch = match self.last_odds_poll {
            Some(last) => cycle_start.duration_since(last) >= interval,
            None => true,
        };

        // Always fetch odds + build diagnostic rows on schedule, even when no
        // Kalshi markets are open.  The diagnostic view needs all games.
        if should_fetch {
            if let Some(source) = odds_sources.get_mut(&self.odds_source) {
                match source.fetch_odds(&self.key).await {
                    Ok(updates) => {
                        self.last_odds_poll = Some(Instant::now());
                        let ctimes: Vec<String> =
                            updates.iter().map(|u| u.commence_time.clone()).collect();
                        self.commence_times = ctimes;

                        // Update API quota
                        if let Some(quota) = source.last_quota() {
                            api_request_times.push_back(Instant::now());
                            let one_hour_ago = Instant::now() - Duration::from_secs(3600);
                            while api_request_times.front().is_some_and(|&t| t < one_hour_ago) {
                                api_request_times.pop_front();
                            }
                            let burn_rate = api_request_times.len() as f64;
                            state_tx.send_modify(|s| {
                                s.api_requests_used = quota.requests_used;
                                s.api_requests_remaining = quota.requests_remaining;
                                s.api_burn_rate = burn_rate;
                                s.api_hours_remaining = if burn_rate > 0.0 {
                                    quota.requests_remaining as f64 / burn_rate
                                } else {
                                    f64::INFINITY
                                };
                            });
                        }

                        let source_name = format_source_name(&self.odds_source);
                        self.diagnostic_rows =
                            build_diagnostic_rows(&updates, &self.key, market_index, &source_name);
                        self.cached_odds = updates;
                    }
                    Err(e) => {
                        tracing::warn!(sport = %self.key, error = %e, "odds fetch failed");
                    }
                }
            }
        }

        // Pre-check: does this sport have any game that COULD be live?
        let now_utc_precheck = chrono::Utc::now();
        let sport_key_normalized: String = self
            .key
            .to_uppercase()
            .chars()
            .filter(|c| c.is_ascii_alphabetic())
            .collect();
        let sport_has_eligible_games = market_index.iter().any(|(key, game)| {
            if key.sport != sport_key_normalized {
                return false;
            }
            let sides = [game.home.as_ref(), game.away.as_ref(), game.draw.as_ref()];
            sides.iter().any(|s| {
                s.is_some_and(|sm| {
                    (sm.status == "open" || sm.status == "active")
                        && sm
                            .close_time
                            .as_deref()
                            .and_then(|ct| chrono::DateTime::parse_from_rfc3339(ct).ok())
                            .is_none_or(|ct| ct.with_timezone(&chrono::Utc) > now_utc_precheck)
                })
            })
        });

        if !sport_has_eligible_games {
            let sport_game_count = market_index
                .keys()
                .filter(|k| k.sport == sport_key_normalized)
                .count();

            // In sim mode, check for open positions on this sport's tickers
            // so process_sport_updates can detect closure and settle them.
            let has_unsettled_positions = sim_mode && {
                let positions = &state_tx.borrow().sim_positions;
                !positions.is_empty()
                    && market_index
                        .iter()
                        .filter(|(k, _)| k.sport == sport_key_normalized)
                        .any(|(_, game)| {
                            [game.home.as_ref(), game.away.as_ref(), game.draw.as_ref()]
                                .into_iter()
                                .flatten()
                                .any(|side| positions.iter().any(|p| p.ticker == side.ticker))
                        })
            };

            if !has_unsettled_positions {
                return TickResult {
                    filter_live: 0,
                    filter_pre_game: 0,
                    filter_closed: sport_game_count,
                    earliest_commence: None,
                    rows: HashMap::new(),
                    has_live_games: false,
                    closed_tickers: Vec::new(),
                    order_intents: Vec::new(),
                };
            }
            // Fall through to process_sport_updates so closed markets produce
            // closed_tickers entries for sim settlement.
        }

        // Process (fresh or cached)
        if self.cached_odds.is_empty() {
            return TickResult {
                filter_live: 0,
                filter_pre_game: 0,
                filter_closed: 0,
                earliest_commence: None,
                rows: HashMap::new(),
                has_live_games: false,
                closed_tickers: Vec::new(),
                order_intents: Vec::new(),
            };
        }

        process_sport_updates(
            &self.cached_odds,
            &self.key,
            market_index,
            live_book,
            &self.strategy_config,
            &self.momentum_config,
            &mut self.velocity_trackers,
            &mut self.book_pressure_trackers,
            scorer,
            sim_mode,
            state_tx,
            cycle_start,
            !should_fetch,
            sim_config,
            risk_config,
            bankroll_cents,
        )
    }
}

/// Results from one pipeline tick.
pub struct TickResult {
    pub filter_live: usize,
    pub filter_pre_game: usize,
    pub filter_closed: usize,
    pub earliest_commence: Option<chrono::DateTime<chrono::Utc>>,
    pub rows: HashMap<String, MarketRow>,
    #[allow(dead_code)]
    pub has_live_games: bool,
    /// Tickers detected as closed this cycle, with their last fair value (for sim settlement).
    pub closed_tickers: Vec<(String, u32)>,
    /// Order intents produced by evaluation in live mode.
    pub order_intents: Vec<OrderIntent>,
}

// ── Moved helper functions ─────────────────────────────────────────────

/// Result of evaluating a single matched market through the common pipeline.
pub enum EvalOutcome {
    /// Market is closed or filtered out.
    Closed,
    /// Market was evaluated successfully, with an optional order intent for live mode.
    Evaluated(MarketRow, Option<OrderIntent>),
}

/// An intent to place an order, produced by the evaluation pipeline in live mode.
#[derive(Debug, Clone)]
pub struct OrderIntent {
    pub ticker: String,
    pub quantity: u32,
    pub price: u32,
    pub is_buy: bool,
    pub is_taker: bool,
    pub edge: i32,
    pub net_profit_estimate: i32,
    pub fair_value: u32,
    pub source: String,
    pub trace: SignalTrace,
    pub entry_cost_cents: u32,
    pub sell_target: u32,
}

/// Build diagnostic rows from all odds updates for a given sport.
pub fn build_diagnostic_rows(
    updates: &[OddsUpdate],
    sport: &str,
    market_index: &matcher::MarketIndex,
    source_name: &str,
) -> Vec<DiagnosticRow> {
    let eastern = chrono::FixedOffset::west_opt(5 * 3600)
        .unwrap_or_else(|| chrono::FixedOffset::west_opt(0).unwrap());
    let now_utc = chrono::Utc::now();

    updates
        .iter()
        .map(|update| {
            let matchup = format!("{} vs {}", update.away_team, update.home_team);

            let commence_et = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
                .ok()
                .map(|dt| dt.with_timezone(&eastern).format("%b %d %H:%M").to_string())
                .unwrap_or_else(|| update.commence_time.clone());

            let commence_dt = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
                .ok()
                .map(|dt| dt.with_timezone(&chrono::Utc));

            let game_status = match commence_dt {
                Some(ct) if ct <= now_utc => "Live".to_string(),
                Some(ct) => {
                    let diff = ct - now_utc;
                    let total_secs = diff.num_seconds().max(0) as u64;
                    let h = total_secs / 3600;
                    let m = (total_secs % 3600) / 60;
                    if h > 0 {
                        format!("Upcoming ({}h {:02}m)", h, m)
                    } else {
                        format!("Upcoming ({}m)", m)
                    }
                }
                None => "Unknown".to_string(),
            };

            let date = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
                .ok()
                .map(|dt| dt.with_timezone(&eastern).date_naive());

            let (lookup_home, lookup_away) = if sport == "mma" {
                (
                    crate::last_name(&update.home_team).to_string(),
                    crate::last_name(&update.away_team).to_string(),
                )
            } else {
                (update.home_team.clone(), update.away_team.clone())
            };

            let matched_game = date.and_then(|d| {
                matcher::generate_key(sport, &lookup_home, &lookup_away, d)
                    .and_then(|k| market_index.get(&k))
            });

            let (kalshi_ticker, market_status, reason) = match matched_game {
                Some(game) => {
                    let side = game
                        .home
                        .as_ref()
                        .or(game.away.as_ref())
                        .or(game.draw.as_ref());

                    match side {
                        Some(sm) => {
                            let market_st = if sm.status == "open" || sm.status == "active" {
                                "Open"
                            } else {
                                "Closed"
                            };
                            let reason = if game_status.starts_with("Live") {
                                "Live & tradeable".to_string()
                            } else {
                                "Not started yet".to_string()
                            };
                            (Some(sm.ticker.clone()), Some(market_st.to_string()), reason)
                        }
                        None => (None, None, "No match found".to_string()),
                    }
                }
                None => (None, None, "No match found".to_string()),
            };

            DiagnosticRow {
                sport: sport.to_string(),
                matchup,
                commence_time: commence_et,
                game_status,
                kalshi_ticker,
                market_status,
                reason,
                source: source_name.to_string(),
            }
        })
        .collect()
}

/// Build diagnostic rows from score updates for a given sport.
pub fn build_diagnostic_rows_from_scores(
    updates: &[crate::feed::score_feed::ScoreUpdate],
    sport: &str,
    market_index: &matcher::MarketIndex,
    source_name: &str,
) -> Vec<DiagnosticRow> {
    let eastern = chrono::FixedOffset::west_opt(5 * 3600)
        .unwrap_or_else(|| chrono::FixedOffset::west_opt(0).unwrap());

    updates
        .iter()
        .map(|update| {
            let matchup = format!("{} vs {}", update.away_team, update.home_team);

            // Format commence time: for score feeds we don't have it, use "—"
            // Game status from ScoreUpdate
            let game_status = match &update.game_status {
                crate::feed::score_feed::GameStatus::PreGame => "Pre-Game".to_string(),
                crate::feed::score_feed::GameStatus::Live => {
                    let clock_mins = update.clock_seconds / 60;
                    let clock_secs = update.clock_seconds % 60;
                    format!(
                        "Live (P{} {}:{:02} {}-{})",
                        update.period, clock_mins, clock_secs, update.home_score, update.away_score
                    )
                }
                crate::feed::score_feed::GameStatus::Halftime => "Halftime".to_string(),
                crate::feed::score_feed::GameStatus::Finished => "Final".to_string(),
            };

            // Score feeds don't have a scheduled commence time in the struct,
            // so we use a placeholder
            let commence_time = "—".to_string();

            // Try to match against Kalshi markets
            // We don't have a date from ScoreUpdate, so we'll use today's date
            let today = chrono::Utc::now().with_timezone(&eastern).date_naive();

            let (lookup_home, lookup_away) = if sport == "mma" {
                (
                    crate::last_name(&update.home_team).to_string(),
                    crate::last_name(&update.away_team).to_string(),
                )
            } else {
                (update.home_team.clone(), update.away_team.clone())
            };

            let matched_game = matcher::generate_key(sport, &lookup_home, &lookup_away, today)
                .and_then(|k| market_index.get(&k));

            let (kalshi_ticker, market_status, reason) = match matched_game {
                Some(game) => {
                    let side = game
                        .home
                        .as_ref()
                        .or(game.away.as_ref())
                        .or(game.draw.as_ref());

                    match side {
                        Some(sm) => {
                            let market_st = if sm.status == "open" || sm.status == "active" {
                                "Open"
                            } else {
                                "Closed"
                            };
                            let reason = match &update.game_status {
                                crate::feed::score_feed::GameStatus::Live => {
                                    "Live & tradeable".to_string()
                                }
                                crate::feed::score_feed::GameStatus::PreGame => {
                                    "Not started yet".to_string()
                                }
                                _ => "Game ended".to_string(),
                            };
                            (Some(sm.ticker.clone()), Some(market_st.to_string()), reason)
                        }
                        None => (None, None, "No match found".to_string()),
                    }
                }
                None => (None, None, "No match found".to_string()),
            };

            DiagnosticRow {
                sport: sport.to_string(),
                matchup,
                commence_time,
                game_status,
                kalshi_ticker,
                market_status,
                reason,
                source: source_name.to_string(),
            }
        })
        .collect()
}

/// Format fair value basis from SignalTrace inputs for display.
pub fn format_fair_value_basis(trace: &SignalTrace) -> String {
    match &trace.inputs {
        FairValueInputs::Score {
            home_score,
            away_score,
            win_prob,
            ..
        } => {
            format!("{}-{} (wp={:.2})", home_score, away_score, win_prob)
        }
        FairValueInputs::Odds { devigged_prob, .. } => {
            format!("devig p={:.2}", devigged_prob)
        }
    }
}

/// Helper function to format source names for display.
fn format_source_name(source_key: &str) -> String {
    match source_key {
        "the-odds-api" => "TheOddsAPI".to_string(),
        "draftkings" => "DraftKings".to_string(),
        "scraped-bovada" => "Bovada".to_string(),
        other => other.to_string(),
    }
}

/// Common evaluation pipeline for a matched Kalshi market.
#[allow(clippy::too_many_arguments)]
pub fn evaluate_matched_market(
    ticker: &str,
    fair: u32,
    fallback_bid: u32,
    fallback_ask: u32,
    is_inverse: bool,
    velocity_score: f64,
    staleness_secs: Option<u64>,
    is_stale: bool,
    side_market: Option<&matcher::SideMarket>,
    now_utc: chrono::DateTime<chrono::Utc>,
    live_book_engine: &LiveBook,
    strategy_config: &StrategyConfig,
    momentum_config: &MomentumConfig,
    book_pressure_trackers: &mut HashMap<String, BookPressureTracker>,
    scorer: &MomentumScorer,
    sim_mode: bool,
    state_tx: &watch::Sender<AppState>,
    cycle_start: Instant,
    source: &str,
    sim_config: &crate::config::SimulationConfig,
    risk_config: &crate::config::RiskConfig,
    bankroll_cents: u64,
    sport: &str,
    fair_value_method: FairValueMethod,
    fair_value_inputs: FairValueInputs,
    odds_api_fair_value: Option<u32>,
) -> EvalOutcome {
    // Check market is open
    let market_open = side_market.is_some_and(|sm| {
        (sm.status == "open" || sm.status == "active")
            && sm
                .close_time
                .as_deref()
                .and_then(|ct| chrono::DateTime::parse_from_rfc3339(ct).ok())
                .is_none_or(|ct| ct.with_timezone(&chrono::Utc) > now_utc)
    });
    if !market_open {
        return EvalOutcome::Closed;
    }

    // Get live bid/ask from orderbook
    let (bid, ask) = if let Ok(book) = live_book_engine.lock() {
        if let Some(depth) = book.get(ticker) {
            let (yes_bid, yes_ask, _, _) = depth.best_bid_ask();
            if yes_ask > 0 {
                (yes_bid, yes_ask)
            } else {
                (fallback_bid, fallback_ask)
            }
        } else {
            (fallback_bid, fallback_ask)
        }
    } else {
        (fallback_bid, fallback_ask)
    };

    // Book pressure
    let bpt = book_pressure_trackers
        .entry(ticker.to_string())
        .or_insert_with(|| BookPressureTracker::new(10));
    if let Ok(book) = live_book_engine.lock() {
        if let Some(depth) = book.get(ticker) {
            let (yb, _, _, _) = depth.best_bid_ask();
            bpt.push(yb as u64, 100u64.saturating_sub(yb as u64), Instant::now());
        }
    }
    let pressure_score = bpt.score();
    let momentum = scorer.composite(velocity_score, pressure_score);

    let fv_source = match &fair_value_method {
        FairValueMethod::OddsFeed { source } => source.clone(),
        FairValueMethod::ScoreFeed { source } => source.clone(),
    };

    // CRITICAL: Skip stale data before strategy evaluation
    if is_stale {
        let row = MarketRow {
            ticker: ticker.to_string(),
            fair_value: fair,
            bid,
            ask,
            edge: 0,
            action: "STALE".to_string(),
            latency_ms: Some(cycle_start.elapsed().as_millis() as u64),
            momentum_score: momentum,
            staleness_secs,
            odds_api_fair_value,
            fair_value_source: fv_source,
        };
        return EvalOutcome::Evaluated(row, None);
    }

    // Evaluate strategy
    let mut signal = strategy::evaluate_with_slippage(
        fair,
        bid,
        ask,
        strategy_config.taker_edge_threshold,
        strategy_config.maker_edge_threshold,
        strategy_config.min_edge_after_fees,
        bankroll_cents,
        risk_config.kelly_fraction,
        risk_config.max_contracts_per_market,
        strategy_config.slippage_buffer_cents,
    );

    let bypass_momentum = momentum_config.bypass_for_score_signals && source == "score_feed";
    let pre_gate_action = signal.action.clone();
    if !bypass_momentum {
        signal = strategy::momentum_gate(
            signal,
            momentum,
            momentum_config.maker_momentum_threshold,
            momentum_config.taker_momentum_threshold,
        );
    }
    let momentum_gated = pre_gate_action != signal.action && !bypass_momentum;

    let action_str = match &signal.action {
        strategy::TradeAction::TakerBuy => "TAKER",
        strategy::TradeAction::MakerBuy { .. } => "MAKER",
        strategy::TradeAction::Skip => "SKIP",
    };

    // Build signal trace for provenance
    let trace = SignalTrace {
        sport: sport.to_string(),
        ticker: ticker.to_string(),
        timestamp: Instant::now(),
        fair_value_method,
        fair_value_cents: fair,
        inputs: fair_value_inputs,
        best_bid: bid,
        best_ask: ask,
        edge: signal.edge,
        action: action_str.to_string(),
        net_profit_estimate: signal.net_profit_estimate,
        quantity: signal.quantity,
        momentum_score: momentum,
        momentum_gated,
    };

    let row = MarketRow {
        ticker: ticker.to_string(),
        fair_value: fair,
        bid,
        ask,
        edge: signal.edge,
        action: action_str.to_string(),
        latency_ms: Some(cycle_start.elapsed().as_millis() as u64),
        momentum_score: momentum,
        staleness_secs,
        odds_api_fair_value,
        fair_value_source: fv_source,
    };

    if signal.action != strategy::TradeAction::Skip {
        let mode_label = if sim_mode { "sim" } else { "live" };
        tracing::warn!(
            ticker = %ticker,
            action = %action_str,
            price = signal.price,
            edge = signal.edge,
            net = signal.net_profit_estimate,
            inverse = is_inverse,
            momentum = format!("{:.0}", momentum),
            source = source,
            mode = mode_label,
            "signal detected"
        );
    }

    // Common break-even validation for both sim and live
    if signal.action != strategy::TradeAction::Skip {
        let fill_price = match &signal.action {
            strategy::TradeAction::TakerBuy => ask,
            strategy::TradeAction::MakerBuy { bid_price } => *bid_price,
            strategy::TradeAction::Skip => unreachable!(),
        };

        let qty = signal.quantity;
        let is_taker = matches!(signal.action, strategy::TradeAction::TakerBuy);
        let entry_cost = (qty * fill_price) as i64;
        let entry_fee = calculate_fee(fill_price, qty, is_taker) as i64;
        let total_cost = entry_cost + entry_fee;
        let entry_cost_total = entry_cost + entry_fee;

        // Validate break-even is achievable before entering
        if let Some(be_price) =
            crate::engine::fees::break_even_sell_price(entry_cost_total as u32, qty, true)
        {
            if be_price > 95 {
                tracing::warn!(
                    ticker = %ticker,
                    break_even = be_price,
                    "skipping trade: break-even too high (>95c)"
                );
                return EvalOutcome::Evaluated(row, None);
            }
        } else {
            tracing::warn!(
                ticker = %ticker,
                entry_cost = entry_cost_total,
                quantity = qty,
                "skipping trade: impossible to break even"
            );
            return EvalOutcome::Evaluated(row, None);
        }

        let sell_target = if sim_config.use_break_even_exit {
            let total_entry = (qty * fill_price) + calculate_fee(fill_price, qty, is_taker);
            match crate::engine::fees::break_even_sell_price(total_entry, qty, false) {
                Some(price) => price,
                None => {
                    tracing::warn!(
                        ticker = %ticker,
                        total_entry,
                        quantity = qty,
                        "skipping trade: no viable sell target"
                    );
                    return EvalOutcome::Evaluated(row, None);
                }
            }
        } else {
            fair
        };

        if sim_mode {
            // Simulation mode: mutate state directly
            let signal_ask = ask;
            let slippage = fill_price as i32 - signal_ask as i32;

            let ticker_owned = ticker.to_string();
            state_tx.send_modify(|s| {
                if s.sim_balance_cents < total_cost {
                    return;
                }
                if s.sim_positions.iter().any(|p| p.ticker == ticker_owned) {
                    return;
                }
                s.sim_balance_cents -= total_cost;
                s.sim_positions.push(crate::tui::state::SimPosition {
                    ticker: ticker_owned.clone(),
                    quantity: qty,
                    entry_price: fill_price,
                    sell_price: sell_target,
                    entry_fee: entry_fee as u32,
                    filled_at: std::time::Instant::now(),
                    signal_ask,
                    trace: Some(trace.clone()),
                });
                s.push_trade(crate::tui::state::TradeRow {
                    time: chrono::Local::now().format("%H:%M:%S").to_string(),
                    action: "BUY".to_string(),
                    ticker: ticker_owned.clone(),
                    price: fill_price,
                    quantity: qty,
                    order_type: "SIM".to_string(),
                    pnl: None,
                    slippage: Some(slippage),
                    source: source.to_string(),
                    fair_value_basis: format_fair_value_basis(&trace),
                });
                s.push_log(
                    "TRADE",
                    format!(
                        "SIM BUY {}x {} @ {}c (ask was {}c, slip {:+}c), sell target {}c",
                        qty, ticker_owned, fill_price, signal_ask, slippage, sell_target
                    ),
                );
                s.sim_total_slippage_cents += slippage as i64;
            });

            return EvalOutcome::Evaluated(row, None);
        } else {
            // Live mode: produce an OrderIntent for the engine loop to execute
            let intent = OrderIntent {
                ticker: ticker.to_string(),
                quantity: qty,
                price: fill_price,
                is_buy: true,
                is_taker,
                edge: signal.edge,
                net_profit_estimate: signal.net_profit_estimate,
                fair_value: fair,
                source: source.to_string(),
                trace,
                entry_cost_cents: total_cost as u32,
                sell_target,
            };
            return EvalOutcome::Evaluated(row, Some(intent));
        }
    }

    EvalOutcome::Evaluated(row, None)
}

/// Process score feed updates through the fair-value/matching/evaluation pipeline.
/// Unified for all sports: uses `regulation_secs` to determine OT threshold.
#[allow(clippy::too_many_arguments)]
fn process_score_updates(
    updates: &[ScoreUpdate],
    sport: &str,
    regulation_secs: u16,
    market_index: &matcher::MarketIndex,
    live_book_engine: &LiveBook,
    strategy_config: &StrategyConfig,
    momentum_config: &MomentumConfig,
    velocity_trackers: &mut HashMap<String, VelocityTracker>,
    book_pressure_trackers: &mut HashMap<String, BookPressureTracker>,
    scorer: &MomentumScorer,
    sim_mode: bool,
    state_tx: &watch::Sender<AppState>,
    cycle_start: Instant,
    last_score_fetch: &HashMap<String, Instant>,
    sim_config: &crate::config::SimulationConfig,
    fair_value_source: &FairValueSource,
    risk_config: &crate::config::RiskConfig,
    bankroll_cents: u64,
    cached_odds_for_validation: &[OddsUpdate],
) -> TickResult {
    let mut filter_live: usize = 0;
    let mut filter_pre_game: usize = 0;
    let mut filter_closed: usize = 0;
    let earliest_commence: Option<chrono::DateTime<chrono::Utc>> = None;
    let mut rows: HashMap<String, MarketRow> = HashMap::new();
    let mut has_live_games = false;
    let mut closed_tickers: Vec<(String, u32)> = Vec::new();
    let mut order_intents: Vec<OrderIntent> = Vec::new();
    let now_utc = chrono::Utc::now();

    // Get win_prob_table from fair_value_source
    let win_prob_table = match fair_value_source {
        FairValueSource::ScoreFeed { win_prob, .. } => win_prob,
        _ => {
            return TickResult {
                filter_live: 0,
                filter_pre_game: 0,
                filter_closed: 0,
                earliest_commence: None,
                rows: HashMap::new(),
                has_live_games: false,
                closed_tickers: Vec::new(),
                order_intents: Vec::new(),
            }
        }
    };

    // Build odds-api fair value lookup from cached odds (for validation mode).
    // Maps (normalized_home, normalized_away) -> home_fair_value_cents.
    let odds_api_fv_lookup: HashMap<(String, String), u32> = if !cached_odds_for_validation.is_empty()
    {
        cached_odds_for_validation
            .iter()
            .filter_map(|ou| {
                let (home_fv, _) = {
                    let avg = average_bookmaker_odds(&ou.bookmakers)?;
                    let (home_odds, away_odds, _, _, _) = avg;
                    let (hfv, _afv) = strategy::devig(home_odds, away_odds);
                    (strategy::fair_value_cents(hfv), strategy::fair_value_cents(_afv))
                };
                let home_norm = ou.home_team.to_uppercase();
                let away_norm = ou.away_team.to_uppercase();
                Some(((home_norm, away_norm), home_fv))
            })
            .collect()
    } else {
        HashMap::new()
    };

    // OT period threshold: for 2-half sports (regulation <= 2400), OT at period > 2.
    // For 4-quarter sports (regulation > 2400), OT at period > 4.
    let ot_period_threshold: u8 = if regulation_secs <= 2400 { 2 } else { 4 };

    for update in updates {
        match update.game_status {
            crate::feed::score_feed::GameStatus::PreGame => {
                filter_pre_game += 1;
                continue;
            }
            crate::feed::score_feed::GameStatus::Finished => {
                filter_closed += 1;
                // Record closed ticker with fair value for sim settlement
                if sim_mode {
                    let score_diff = update.home_score as i32 - update.away_score as i32;
                    let (home_fair, _) = if update.period > ot_period_threshold {
                        let ot_elapsed =
                            update.total_elapsed_seconds.saturating_sub(regulation_secs);
                        win_prob_table.fair_value_overtime(score_diff, ot_elapsed)
                    } else {
                        win_prob_table.fair_value(score_diff, update.total_elapsed_seconds)
                    };
                    let eastern = chrono::FixedOffset::west_opt(5 * 3600).unwrap();
                    let today = chrono::Utc::now().with_timezone(&eastern).date_naive();
                    if let Some(mkt) = matcher::find_match(
                        market_index,
                        sport,
                        &update.home_team,
                        &update.away_team,
                        today,
                    ) {
                        closed_tickers.push((mkt.ticker.clone(), home_fair));
                    }
                }
                continue;
            }
            _ => {} // Live or Halftime
        }

        has_live_games = true;

        let staleness_secs = last_score_fetch
            .get(&update.game_id)
            .map(|t| cycle_start.duration_since(*t).as_secs());
        let is_stale = staleness_secs.is_some_and(|s| s > 10);

        let score_diff = update.home_score as i32 - update.away_score as i32;
        let (home_fair, _away_fair) = if update.period > ot_period_threshold {
            let ot_elapsed = update.total_elapsed_seconds.saturating_sub(regulation_secs);
            win_prob_table.fair_value_overtime(score_diff, ot_elapsed)
        } else {
            win_prob_table.fair_value(score_diff, update.total_elapsed_seconds)
        };

        let vt = velocity_trackers
            .entry(update.game_id.clone())
            .or_insert_with(|| VelocityTracker::new(momentum_config.velocity_window_size));
        vt.push(home_fair as f64 / 100.0, Instant::now());
        let velocity_score = vt.score();

        let eastern = chrono::FixedOffset::west_opt(5 * 3600).unwrap();
        let today = chrono::Utc::now().with_timezone(&eastern).date_naive();

        if let Some(mkt) = matcher::find_match(
            market_index,
            sport,
            &update.home_team,
            &update.away_team,
            today,
        ) {
            let fair = home_fair;
            let key_check =
                matcher::generate_key(sport, &update.home_team, &update.away_team, today);
            let game_check = key_check.and_then(|k| market_index.get(&k));
            let side_market = game_check.and_then(|g| {
                if mkt.is_inverse {
                    g.away.as_ref()
                } else {
                    g.home.as_ref()
                }
            });

            // Look up odds-api fair value for this game (validation mode)
            let oa_fv = if !odds_api_fv_lookup.is_empty() {
                let home_norm = update.home_team.to_uppercase();
                let away_norm = update.away_team.to_uppercase();
                odds_api_fv_lookup
                    .get(&(home_norm, away_norm))
                    .copied()
            } else {
                None
            };

            let fv_method = FairValueMethod::ScoreFeed {
                source: "score-feed".to_string(),
            };
            let fv_inputs = FairValueInputs::Score {
                home_score: update.home_score as u32,
                away_score: update.away_score as u32,
                elapsed_secs: update.total_elapsed_seconds as u32,
                period: format!("{}", update.period),
                win_prob: home_fair as f64 / 100.0,
            };

            match evaluate_matched_market(
                &mkt.ticker,
                fair,
                mkt.best_bid,
                mkt.best_ask,
                mkt.is_inverse,
                velocity_score,
                staleness_secs,
                is_stale,
                side_market,
                now_utc,
                live_book_engine,
                strategy_config,
                momentum_config,
                book_pressure_trackers,
                scorer,
                sim_mode,
                state_tx,
                cycle_start,
                "score_feed",
                sim_config,
                risk_config,
                bankroll_cents,
                sport,
                fv_method,
                fv_inputs,
                oa_fv,
            ) {
                EvalOutcome::Closed => {
                    filter_closed += 1;
                    if sim_mode {
                        closed_tickers.push((mkt.ticker.clone(), fair));
                    }
                }
                EvalOutcome::Evaluated(row, intent) => {
                    filter_live += 1;
                    if let Some(i) = intent {
                        order_intents.push(i);
                    }
                    rows.insert(mkt.ticker.clone(), row);
                }
            }
        }
    }

    TickResult {
        filter_live,
        filter_pre_game,
        filter_closed,
        earliest_commence,
        rows,
        has_live_games,
        closed_tickers,
        order_intents,
    }
}

/// Average odds across all bookmakers for better fair value estimation.
/// Returns (avg_home_odds, avg_away_odds, avg_draw_odds_if_any, last_update, bookmaker_names).
fn average_bookmaker_odds(
    bookmakers: &[crate::feed::types::BookmakerOdds],
) -> Option<(f64, f64, Option<f64>, String, Vec<String>)> {
    if bookmakers.is_empty() {
        return None;
    }

    let count = bookmakers.len() as f64;
    let avg_home = bookmakers.iter().map(|b| b.home_odds).sum::<f64>() / count;
    let avg_away = bookmakers.iter().map(|b| b.away_odds).sum::<f64>() / count;

    // Average draw odds if all bookmakers have them
    let avg_draw = if bookmakers.iter().all(|b| b.draw_odds.is_some()) {
        Some(bookmakers.iter().filter_map(|b| b.draw_odds).sum::<f64>() / count)
    } else {
        None
    };

    // Use the most recent last_update timestamp
    let last_update = bookmakers
        .iter()
        .map(|b| &b.last_update)
        .max()
        .cloned()
        .unwrap_or_default();

    let bookmaker_names = bookmakers.iter().map(|b| b.name.clone()).collect();

    Some((avg_home, avg_away, avg_draw, last_update, bookmaker_names))
}

/// Process odds updates for a single sport through the filter/matching/evaluation pipeline.
#[allow(clippy::too_many_arguments)]
fn process_sport_updates(
    updates: &[OddsUpdate],
    sport: &str,
    market_index: &matcher::MarketIndex,
    live_book_engine: &LiveBook,
    strategy_config: &StrategyConfig,
    momentum_config: &MomentumConfig,
    velocity_trackers: &mut HashMap<String, VelocityTracker>,
    book_pressure_trackers: &mut HashMap<String, BookPressureTracker>,
    scorer: &MomentumScorer,
    sim_mode: bool,
    state_tx: &watch::Sender<AppState>,
    cycle_start: Instant,
    is_replay: bool,
    sim_config: &crate::config::SimulationConfig,
    risk_config: &crate::config::RiskConfig,
    bankroll_cents: u64,
) -> TickResult {
    let mut filter_live: usize = 0;
    let mut filter_pre_game: usize = 0;
    let mut filter_closed: usize = 0;
    let mut earliest_commence: Option<chrono::DateTime<chrono::Utc>> = None;
    let mut rows: HashMap<String, MarketRow> = HashMap::new();
    let mut has_live_games = false;
    let mut closed_tickers: Vec<(String, u32)> = Vec::new();
    let mut order_intents: Vec<OrderIntent> = Vec::new();

    for update in updates {
        // Average odds across all bookmakers for better fair value estimation
        let Some((home_odds, away_odds, draw_odds, last_update, bookmaker_names)) =
            average_bookmaker_odds(&update.bookmakers)
        else {
            continue;
        };

        let eastern = chrono::FixedOffset::west_opt(5 * 3600).unwrap();
        let date = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
            .ok()
            .map(|dt| dt.with_timezone(&eastern).date_naive());

        let Some(date) = date else { continue };

        let now_utc = chrono::Utc::now();
        let commence_dt = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
            .ok()
            .map(|dt| dt.with_timezone(&chrono::Utc));

        let game_started = commence_dt.is_some_and(|ct| ct <= now_utc);

        if !game_started {
            filter_pre_game += 1;
            if let Some(ct) = commence_dt {
                earliest_commence = Some(match earliest_commence {
                    Some(existing) => existing.min(ct),
                    None => ct,
                });
            }
            continue;
        }

        has_live_games = true;

        let (lookup_home, lookup_away) = if sport == "mma" {
            (
                crate::last_name(&update.home_team).to_string(),
                crate::last_name(&update.away_team).to_string(),
            )
        } else {
            (update.home_team.clone(), update.away_team.clone())
        };

        let is_3way = sport.starts_with("soccer");

        let vt = velocity_trackers
            .entry(update.event_id.clone())
            .or_insert_with(|| VelocityTracker::new(momentum_config.velocity_window_size));

        if is_3way {
            let Some(draw_odds_val) = draw_odds else {
                tracing::warn!(sport, home = %update.home_team, "skipping soccer event: missing draw odds");
                continue;
            };
            let (home_fv, away_fv, draw_fv) =
                strategy::devig_3way(home_odds, away_odds, draw_odds_val);

            if !is_replay {
                vt.push(home_fv, Instant::now());
            }
            let velocity_score = vt.score();

            let key = matcher::generate_key(sport, &lookup_home, &lookup_away, date);
            let game = key.and_then(|k| market_index.get(&k));

            if let Some(game) = game {
                let sides: Vec<(Option<&matcher::SideMarket>, u32, &str, f64)> = vec![
                    (
                        game.home.as_ref(),
                        strategy::fair_value_cents(home_fv),
                        "HOME",
                        home_fv,
                    ),
                    (
                        game.away.as_ref(),
                        strategy::fair_value_cents(away_fv),
                        "AWAY",
                        away_fv,
                    ),
                    (
                        game.draw.as_ref(),
                        strategy::fair_value_cents(draw_fv),
                        "DRAW",
                        draw_fv,
                    ),
                ];

                for (side_opt, fair, label, devigged_prob) in sides {
                    let Some(side) = side_opt else { continue };

                    let staleness_secs = chrono::DateTime::parse_from_rfc3339(&last_update)
                        .ok()
                        .map(|dt| {
                            let age = now_utc - dt.with_timezone(&chrono::Utc);
                            age.num_seconds().max(0) as u64
                        });

                    let fv_method = FairValueMethod::OddsFeed {
                        source: "odds-api".to_string(),
                    };
                    let fv_inputs = FairValueInputs::Odds {
                        home_odds,
                        away_odds,
                        bookmakers: bookmaker_names.clone(),
                        devigged_prob,
                    };

                    match evaluate_matched_market(
                        &side.ticker,
                        fair,
                        side.yes_bid,
                        side.yes_ask,
                        false,
                        velocity_score,
                        staleness_secs,
                        false,
                        Some(side),
                        now_utc,
                        live_book_engine,
                        strategy_config,
                        momentum_config,
                        book_pressure_trackers,
                        scorer,
                        sim_mode,
                        state_tx,
                        cycle_start,
                        label,
                        sim_config,
                        risk_config,
                        bankroll_cents,
                        sport,
                        fv_method,
                        fv_inputs,
                        None, // odds-feed sports don't need comparison FV
                    ) {
                        EvalOutcome::Closed => {
                            filter_closed += 1;
                            if sim_mode {
                                closed_tickers.push((side.ticker.clone(), fair));
                            }
                        }
                        EvalOutcome::Evaluated(row, intent) => {
                            filter_live += 1;
                            if let Some(i) = intent {
                                order_intents.push(i);
                            }
                            rows.insert(side.ticker.clone(), row);
                        }
                    }
                }
            }
        } else {
            let (home_fv, _away_fv) = strategy::devig(home_odds, away_odds);
            let home_cents = strategy::fair_value_cents(home_fv);

            if !is_replay {
                vt.push(home_fv, Instant::now());
            }
            let velocity_score = vt.score();

            if let Some(mkt) =
                matcher::find_match(market_index, sport, &lookup_home, &lookup_away, date)
            {
                let fair = home_cents;

                let key_check = matcher::generate_key(sport, &lookup_home, &lookup_away, date);
                let game_check = key_check.and_then(|k| market_index.get(&k));
                let side_market = game_check.and_then(|g| {
                    if mkt.is_inverse {
                        g.away.as_ref()
                    } else {
                        g.home.as_ref()
                    }
                });

                let staleness_secs =
                    chrono::DateTime::parse_from_rfc3339(&last_update)
                        .ok()
                        .map(|dt| {
                            let age = now_utc - dt.with_timezone(&chrono::Utc);
                            age.num_seconds().max(0) as u64
                        });

                let fv_method = FairValueMethod::OddsFeed {
                    source: "odds-api".to_string(),
                };
                let fv_inputs = FairValueInputs::Odds {
                    home_odds,
                    away_odds,
                    bookmakers: bookmaker_names.clone(),
                    devigged_prob: home_fv,
                };

                match evaluate_matched_market(
                    &mkt.ticker,
                    fair,
                    mkt.best_bid,
                    mkt.best_ask,
                    mkt.is_inverse,
                    velocity_score,
                    staleness_secs,
                    false,
                    side_market,
                    now_utc,
                    live_book_engine,
                    strategy_config,
                    momentum_config,
                    book_pressure_trackers,
                    scorer,
                    sim_mode,
                    state_tx,
                    cycle_start,
                    "odds_api",
                    sim_config,
                    risk_config,
                    bankroll_cents,
                    sport,
                    fv_method,
                    fv_inputs,
                    None, // odds-feed sports don't need comparison FV
                ) {
                    EvalOutcome::Closed => {
                        filter_closed += 1;
                        if sim_mode {
                            closed_tickers.push((mkt.ticker.clone(), fair));
                        }
                    }
                    EvalOutcome::Evaluated(row, intent) => {
                        filter_live += 1;
                        if let Some(i) = intent {
                            order_intents.push(i);
                        }
                        rows.insert(mkt.ticker.clone(), row);
                    }
                }
            }
        }
    }

    TickResult {
        filter_live,
        filter_pre_game,
        filter_closed,
        earliest_commence,
        rows,
        has_live_games,
        closed_tickers,
        order_intents,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::*;

    fn test_global_strategy() -> StrategyConfig {
        StrategyConfig {
            taker_edge_threshold: 5,
            maker_edge_threshold: 2,
            min_edge_after_fees: 1,
            slippage_buffer_cents: 0,
        }
    }

    fn test_global_momentum() -> MomentumConfig {
        MomentumConfig {
            taker_momentum_threshold: 75,
            maker_momentum_threshold: 40,
            cancel_threshold: 30,
            velocity_weight: 0.6,
            book_pressure_weight: 0.4,
            velocity_window_size: 10,
            cancel_check_interval_ms: 1000,
            bypass_for_score_signals: false,
        }
    }

    #[test]
    fn test_odds_feed_pipeline_uses_global_defaults() {
        let sport_config = SportConfig {
            enabled: true,
            kalshi_series: "KXNHLGAME".into(),
            label: "NHL".into(),
            hotkey: "4".into(),
            fair_value: "odds-feed".into(),
            odds_source: "the-odds-api".into(),
            score_feed: None,
            win_prob: None,
            strategy: None,
            momentum: None,
        };
        let pipe = SportPipeline::from_config(
            "ice-hockey",
            &sport_config,
            &test_global_strategy(),
            &test_global_momentum(),
        );
        assert_eq!(pipe.strategy_config.taker_edge_threshold, 5);
        assert_eq!(pipe.momentum_config.taker_momentum_threshold, 75);
        assert!(matches!(pipe.fair_value_source, FairValueSource::OddsFeed));
    }

    #[test]
    fn test_score_feed_pipeline_with_overrides() {
        let sport_config = SportConfig {
            enabled: true,
            kalshi_series: "KXNBAGAME".into(),
            label: "NBA".into(),
            hotkey: "1".into(),
            fair_value: "score-feed".into(),
            odds_source: "the-odds-api".into(),
            score_feed: Some(ScoreFeedConfig {
                primary_url: "https://cdn.nba.com/test".into(),
                fallback_url: Some("https://espn.com/test".into()),
                live_poll_s: 1,
                pre_game_poll_s: 60,
                failover_threshold: 3,
                request_timeout_ms: 5000,
            }),
            win_prob: Some(WinProbConfig {
                home_advantage: 2.5,
                k_start: 0.065,
                k_range: 0.25,
                ot_k_start: 0.10,
                ot_k_range: 1.0,
                regulation_secs: Some(2880),
            }),
            strategy: Some(StrategyOverride {
                taker_edge_threshold: Some(3),
                maker_edge_threshold: Some(1),
                min_edge_after_fees: None,
            }),
            momentum: Some(MomentumOverride {
                taker_momentum_threshold: Some(0),
                maker_momentum_threshold: Some(0),
                cancel_threshold: None,
                velocity_weight: None,
                book_pressure_weight: None,
                velocity_window_size: None,
                cancel_check_interval_ms: None,
            }),
        };
        let pipe = SportPipeline::from_config(
            "basketball",
            &sport_config,
            &test_global_strategy(),
            &test_global_momentum(),
        );
        assert_eq!(pipe.strategy_config.taker_edge_threshold, 3);
        assert_eq!(pipe.strategy_config.min_edge_after_fees, 1); // inherited
        assert_eq!(pipe.momentum_config.taker_momentum_threshold, 0);
        assert!(matches!(
            pipe.fair_value_source,
            FairValueSource::ScoreFeed { .. }
        ));
    }
}
