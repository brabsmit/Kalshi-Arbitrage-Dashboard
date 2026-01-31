mod config;
mod engine;
mod feed;
mod kalshi;
mod tui;

use anyhow::Result;
use config::Config;
use engine::fees::calculate_fee;
use engine::momentum::{BookPressureTracker, MomentumScorer, VelocityTracker};
use engine::{matcher, strategy};
use feed::{the_odds_api::TheOddsApi, OddsFeed};
use kalshi::{auth::KalshiAuth, rest::KalshiRest, ws::KalshiWs};
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch};
use tui::state::{AppState, MarketRow};

/// Results from processing one sport's odds updates.
struct SportProcessResult {
    filter_live: usize,
    filter_pre_game: usize,
    filter_closed: usize,
    earliest_commence: Option<chrono::DateTime<chrono::Utc>>,
    rows: HashMap<String, MarketRow>,
}

/// Per-ticker orderbook depth: price_cents -> quantity for each side.
/// Supports snapshot replacement and incremental delta application.
#[derive(Debug, Clone)]
struct DepthBook {
    yes: HashMap<u32, i64>,
    no: HashMap<u32, i64>,
}

impl DepthBook {
    fn new() -> Self {
        Self {
            yes: HashMap::new(),
            no: HashMap::new(),
        }
    }

    /// Replace entire book from a snapshot message.
    /// Prefers dollar-based fields; falls back to legacy cent fields.
    fn apply_snapshot(&mut self, snap: &kalshi::types::OrderbookSnapshot) {
        self.yes.clear();
        self.no.clear();

        if !snap.yes_dollars.is_empty() || !snap.no_dollars.is_empty() {
            for (price_str, qty) in &snap.yes_dollars {
                if let Ok(d) = price_str.parse::<f64>() {
                    let cents = (d * 100.0).round() as u32;
                    if *qty > 0 {
                        self.yes.insert(cents, *qty);
                    }
                }
            }
            for (price_str, qty) in &snap.no_dollars {
                if let Ok(d) = price_str.parse::<f64>() {
                    let cents = (d * 100.0).round() as u32;
                    if *qty > 0 {
                        self.no.insert(cents, *qty);
                    }
                }
            }
        } else {
            for level in &snap.yes {
                if level[1] > 0 {
                    self.yes.insert(level[0] as u32, level[1]);
                }
            }
            for level in &snap.no {
                if level[1] > 0 {
                    self.no.insert(level[0] as u32, level[1]);
                }
            }
        }
    }

    /// Apply an incremental delta at one price level.
    fn apply_delta(&mut self, side: &str, price_cents: u32, delta: i64) {
        let book = if side == "yes" { &mut self.yes } else { &mut self.no };
        let qty = book.entry(price_cents).or_insert(0);
        *qty += delta;
        if *qty <= 0 {
            book.remove(&price_cents);
        }
    }

    /// Apply a delta using dollar-string price (e.g. "0.5500").
    fn apply_delta_dollars(&mut self, side: &str, price_dollars: &str, delta: i64) {
        if let Ok(d) = price_dollars.parse::<f64>() {
            let cents = (d * 100.0).round() as u32;
            self.apply_delta(side, cents, delta);
        }
    }

    /// Derive best bid/ask from current depth.
    /// Returns (yes_bid, yes_ask, no_bid, no_ask).
    fn best_bid_ask(&self) -> (u32, u32, u32, u32) {
        let yes_bid = self.yes.keys().copied().max().unwrap_or(0);
        let no_bid = self.no.keys().copied().max().unwrap_or(0);
        let yes_ask = if no_bid > 0 { 100 - no_bid } else { 0 };
        let no_ask = if yes_bid > 0 { 100 - yes_bid } else { 0 };
        (yes_bid, yes_ask, no_bid, no_ask)
    }
}

/// Live orderbook: ticker -> full depth book
type LiveBook = Arc<Mutex<HashMap<String, DepthBook>>>;

/// Extract last name from a full name (for MMA fighter matching).
/// "Alex Volkanovski" -> "Volkanovski", "Benoit Saint-Denis" -> "Saint-Denis"
fn last_name(full_name: &str) -> &str {
    full_name.rsplit_once(' ').map_or(full_name, |(_, last)| last)
}

/// Build diagnostic rows from all odds updates for a given sport.
fn build_diagnostic_rows(
    updates: &[feed::types::OddsUpdate],
    sport: &str,
    market_index: &matcher::MarketIndex,
) -> Vec<tui::state::DiagnosticRow> {
    let eastern = chrono::FixedOffset::west_opt(5 * 3600).unwrap();
    let now_utc = chrono::Utc::now();

    updates
        .iter()
        .map(|update| {
            let matchup = format!("{} vs {}", update.away_team, update.home_team);

            // Format commence time in ET
            let commence_et = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
                .ok()
                .map(|dt| dt.with_timezone(&eastern).format("%b %d %H:%M").to_string())
                .unwrap_or_else(|| update.commence_time.clone());

            // Determine game status
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

            // Try to match to Kalshi
            let date = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
                .ok()
                .map(|dt| dt.with_timezone(&eastern).date_naive());

            let (lookup_home, lookup_away) = if sport == "mma" {
                (last_name(&update.home_team).to_string(), last_name(&update.away_team).to_string())
            } else {
                (update.home_team.clone(), update.away_team.clone())
            };

            let matched_game = date.and_then(|d| {
                matcher::generate_key(sport, &lookup_home, &lookup_away, d)
                    .and_then(|k| market_index.get(&k))
            });

            let (kalshi_ticker, market_status, reason) = match matched_game {
                Some(game) => {
                    // Pick the first available side market for display
                    let side = game.home.as_ref()
                        .or(game.away.as_ref())
                        .or(game.draw.as_ref());

                    match side {
                        Some(sm) => {
                            // Market status from Kalshi API (captured at startup).
                            // We only fetch status=open markets, so this is always "open"
                            // at index time. Show as "Open" since Kalshi confirmed it.
                            let market_st = if sm.status == "open" || sm.status == "active" { "Open" } else { "Closed" };

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

            tui::state::DiagnosticRow {
                sport: sport.to_string(),
                matchup,
                commence_time: commence_et,
                game_status,
                kalshi_ticker,
                market_status,
                reason,
            }
        })
        .collect()
}

/// Result of evaluating a single matched market through the common pipeline.
enum EvalOutcome {
    /// Market is closed or filtered out.
    Closed,
    /// Market was evaluated successfully.
    Evaluated(MarketRow),
}

/// Common evaluation pipeline for a matched Kalshi market.
/// Given a fair value and matched ticker, runs through: market open check →
/// bid/ask lookup → book pressure → strategy eval → momentum gate →
/// staleness check → row construction → signal logging → sim fill.
#[allow(clippy::too_many_arguments)]
fn evaluate_matched_market(
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
    strategy_config: &config::StrategyConfig,
    momentum_config: &config::MomentumConfig,
    book_pressure_trackers: &mut HashMap<String, BookPressureTracker>,
    scorer: &MomentumScorer,
    sim_mode: bool,
    state_tx: &watch::Sender<AppState>,
    cycle_start: Instant,
    source: &str,
    sim_config: &config::SimulationConfig,
) -> EvalOutcome {
    // Check market is open
    let market_open = side_market.is_some_and(|sm| {
        (sm.status == "open" || sm.status == "active")
            && sm.close_time.as_deref()
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
            if yes_ask > 0 { (yes_bid, yes_ask) } else { (fallback_bid, fallback_ask) }
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

    // Evaluate strategy
    let mut signal = strategy::evaluate(
        fair, bid, ask,
        strategy_config.taker_edge_threshold,
        strategy_config.maker_edge_threshold,
        strategy_config.min_edge_after_fees,
    );

    // Bypass momentum gating for score-feed signals when configured.
    // Score-derived edge comes from knowing the score before sportsbooks
    // update — requiring momentum confirmation adds delay that erodes
    // the speed advantage.
    let bypass_momentum = momentum_config.bypass_for_score_signals && source == "score_feed";
    if !bypass_momentum {
        signal = strategy::momentum_gate(
            signal,
            momentum,
            momentum_config.maker_momentum_threshold,
            momentum_config.taker_momentum_threshold,
        );
    }

    // Force skip if stale
    if is_stale {
        signal = strategy::StrategySignal {
            action: strategy::TradeAction::Skip,
            price: 0,
            edge: signal.edge,
            net_profit_estimate: 0,
        };
    }

    let action_str = match &signal.action {
        strategy::TradeAction::TakerBuy => "TAKER",
        strategy::TradeAction::MakerBuy { .. } => "MAKER",
        strategy::TradeAction::Skip => "SKIP",
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
    };

    if signal.action != strategy::TradeAction::Skip {
        tracing::warn!(
            ticker = %ticker,
            action = %action_str,
            price = signal.price,
            edge = signal.edge,
            net = signal.net_profit_estimate,
            inverse = is_inverse,
            momentum = format!("{:.0}", momentum),
            source = source,
            "signal detected (dry run)"
        );
    }

    // Simulation mode
    if sim_mode && signal.action != strategy::TradeAction::Skip {
        let signal_ask = ask;
        let fill_price = match &signal.action {
            strategy::TradeAction::TakerBuy => ask,
            strategy::TradeAction::MakerBuy { bid_price } => *bid_price,
            strategy::TradeAction::Skip => unreachable!(),
        };

        let qty = (5000u32 / fill_price).max(1);
        let is_taker = matches!(signal.action, strategy::TradeAction::TakerBuy);
        let entry_cost = (qty * fill_price) as i64;
        let entry_fee = calculate_fee(fill_price, qty, is_taker) as i64;
        let total_cost = entry_cost + entry_fee;

        let sell_target = if sim_config.use_break_even_exit {
            let total_entry = (qty * fill_price) + calculate_fee(fill_price, qty, is_taker);
            engine::fees::break_even_sell_price(total_entry, qty, false)
        } else {
            fair
        };

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
            s.sim_positions.push(tui::state::SimPosition {
                ticker: ticker_owned.clone(),
                quantity: qty,
                entry_price: fill_price,
                sell_price: sell_target,
                entry_fee: entry_fee as u32,
                filled_at: std::time::Instant::now(),
                signal_ask,
            });
            s.push_trade(tui::state::TradeRow {
                time: chrono::Local::now().format("%H:%M:%S").to_string(),
                action: "BUY".to_string(),
                ticker: ticker_owned.clone(),
                price: fill_price,
                quantity: qty,
                order_type: "SIM".to_string(),
                pnl: None,
                slippage: Some(slippage),
            });
            s.push_log("TRADE", format!(
                "SIM BUY {}x {} @ {}¢ (ask was {}¢, slip {:+}¢), sell target {}¢",
                qty, ticker_owned, fill_price, signal_ask, slippage, sell_target
            ));
            s.sim_total_slippage_cents += slippage as i64;
        });
    }

    EvalOutcome::Evaluated(row)
}

/// Process score feed updates for NBA games through the fair-value/matching/evaluation pipeline.
/// Uses WinProbTable for fair value instead of sportsbook odds devigging.
/// Includes staleness tracking: forces Skip when score data > 10s old.
#[allow(clippy::too_many_arguments)]
fn process_score_updates(
    updates: &[feed::score_feed::ScoreUpdate],
    market_index: &matcher::MarketIndex,
    live_book_engine: &LiveBook,
    strategy_config: &config::StrategyConfig,
    momentum_config: &config::MomentumConfig,
    velocity_trackers: &mut HashMap<String, VelocityTracker>,
    book_pressure_trackers: &mut HashMap<String, BookPressureTracker>,
    scorer: &MomentumScorer,
    sim_mode: bool,
    state_tx: &watch::Sender<AppState>,
    cycle_start: Instant,
    last_score_fetch: &HashMap<String, Instant>,
    sim_config: &config::SimulationConfig,
    win_prob_table: &engine::win_prob::WinProbTable,
) -> SportProcessResult {
    let mut filter_live: usize = 0;
    let mut filter_pre_game: usize = 0;
    let mut filter_closed: usize = 0;
    let earliest_commence: Option<chrono::DateTime<chrono::Utc>> = None;
    let mut rows: HashMap<String, MarketRow> = HashMap::new();

    let now_utc = chrono::Utc::now();

    for update in updates {
        match update.game_status {
            feed::score_feed::GameStatus::PreGame => {
                filter_pre_game += 1;
                continue;
            }
            feed::score_feed::GameStatus::Finished => {
                filter_closed += 1;
                continue;
            }
            _ => {} // Live or Halftime — process
        }

        // Check staleness (Task 8)
        let staleness_secs = last_score_fetch.get(&update.game_id)
            .map(|t| cycle_start.duration_since(*t).as_secs());
        let is_stale = staleness_secs.is_some_and(|s| s > 10);

        // Compute fair value from score
        let score_diff = update.home_score as i32 - update.away_score as i32;
        let (home_fair, _away_fair) = if update.period > 4 {
            // Overtime: compute elapsed within the OT period
            let ot_elapsed = update.total_elapsed_seconds.saturating_sub(2880);
            win_prob_table.fair_value_overtime(score_diff, ot_elapsed)
        } else {
            win_prob_table.fair_value(score_diff, update.total_elapsed_seconds)
        };

        // Velocity tracking (use fair value as implied prob for compatibility)
        let vt = velocity_trackers
            .entry(update.game_id.clone())
            .or_insert_with(|| VelocityTracker::new(momentum_config.velocity_window_size));
        vt.push(home_fair as f64 / 100.0, Instant::now());
        let velocity_score = vt.score();

        // Try to find the Kalshi market for this game
        // Use today's date in Eastern time for matching
        let eastern = chrono::FixedOffset::west_opt(5 * 3600).unwrap();
        let today = chrono::Utc::now().with_timezone(&eastern).date_naive();

        if let Some(mkt) = matcher::find_match(
            market_index,
            "basketball",
            &update.home_team,
            &update.away_team,
            today,
        ) {
            let fair = home_fair;

            let key_check = matcher::generate_key("basketball", &update.home_team, &update.away_team, today);
            let game_check = key_check.and_then(|k| market_index.get(&k));
            let side_market = game_check.and_then(|g| {
                if mkt.is_inverse { g.away.as_ref() } else { g.home.as_ref() }
            });

            match evaluate_matched_market(
                &mkt.ticker, fair, mkt.best_bid, mkt.best_ask, mkt.is_inverse,
                velocity_score, staleness_secs, is_stale, side_market, now_utc,
                live_book_engine, strategy_config, momentum_config,
                book_pressure_trackers, scorer, sim_mode, state_tx, cycle_start,
                "score_feed", sim_config,
            ) {
                EvalOutcome::Closed => { filter_closed += 1; }
                EvalOutcome::Evaluated(row) => {
                    filter_live += 1;
                    rows.insert(mkt.ticker.clone(), row);
                }
            }
        }
    }

    SportProcessResult { filter_live, filter_pre_game, filter_closed, earliest_commence, rows }
}

/// Process odds updates for a single sport through the filter/matching/evaluation pipeline.
/// When `is_replay` is true, velocity trackers are not updated (avoids skewing momentum
/// with duplicate data on poll-skip cycles).
#[allow(clippy::too_many_arguments)]
fn process_sport_updates(
    updates: &[feed::types::OddsUpdate],
    sport: &str,
    market_index: &matcher::MarketIndex,
    live_book_engine: &LiveBook,
    strategy_config: &config::StrategyConfig,
    momentum_config: &config::MomentumConfig,
    velocity_trackers: &mut HashMap<String, VelocityTracker>,
    book_pressure_trackers: &mut HashMap<String, BookPressureTracker>,
    scorer: &MomentumScorer,
    sim_mode: bool,
    state_tx: &watch::Sender<AppState>,
    cycle_start: Instant,
    is_replay: bool,
    sim_config: &config::SimulationConfig,
) -> SportProcessResult {
    let mut filter_live: usize = 0;
    let mut filter_pre_game: usize = 0;
    let mut filter_closed: usize = 0;
    let mut earliest_commence: Option<chrono::DateTime<chrono::Utc>> = None;
    let mut rows: HashMap<String, MarketRow> = HashMap::new();

    for update in updates {
        if let Some(bm) = update.bookmakers.first() {
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

            let (lookup_home, lookup_away) = if sport == "mma" {
                (last_name(&update.home_team).to_string(), last_name(&update.away_team).to_string())
            } else {
                (update.home_team.clone(), update.away_team.clone())
            };

            let is_3way = sport.starts_with("soccer");

            let vt = velocity_trackers
                .entry(update.event_id.clone())
                .or_insert_with(|| VelocityTracker::new(momentum_config.velocity_window_size));

            if is_3way {
                // --- 3-way evaluation (soccer) ---
                let Some(draw_odds) = bm.draw_odds else {
                    tracing::warn!(sport, home = %update.home_team, "skipping soccer event: missing draw odds");
                    continue;
                };
                let (home_fv, away_fv, draw_fv) =
                    strategy::devig_3way(bm.home_odds, bm.away_odds, draw_odds);

                if !is_replay {
                    vt.push(home_fv, Instant::now());
                }
                let velocity_score = vt.score();

                let key = matcher::generate_key(sport, &lookup_home, &lookup_away, date);
                let game = key.and_then(|k| market_index.get(&k));

                if let Some(game) = game {
                    let sides: Vec<(Option<&matcher::SideMarket>, u32, &str)> = vec![
                        (game.home.as_ref(), strategy::fair_value_cents(home_fv), "HOME"),
                        (game.away.as_ref(), strategy::fair_value_cents(away_fv), "AWAY"),
                        (game.draw.as_ref(), strategy::fair_value_cents(draw_fv), "DRAW"),
                    ];

                    for (side_opt, fair, label) in sides {
                        let Some(side) = side_opt else { continue };

                        let staleness_secs = chrono::DateTime::parse_from_rfc3339(&bm.last_update)
                            .ok()
                            .map(|dt| {
                                let age = now_utc - dt.with_timezone(&chrono::Utc);
                                age.num_seconds().max(0) as u64
                            });

                        match evaluate_matched_market(
                            &side.ticker, fair, side.yes_bid, side.yes_ask, false,
                            velocity_score, staleness_secs, false, Some(side), now_utc,
                            live_book_engine, strategy_config, momentum_config,
                            book_pressure_trackers, scorer, sim_mode, state_tx, cycle_start,
                            label, sim_config,
                        ) {
                            EvalOutcome::Closed => { filter_closed += 1; }
                            EvalOutcome::Evaluated(row) => {
                                filter_live += 1;
                                rows.insert(side.ticker.clone(), row);
                            }
                        }
                    }
                }
            } else {
                // --- 2-way evaluation ---
                let (home_fv, _away_fv) =
                    strategy::devig(bm.home_odds, bm.away_odds);
                let home_cents = strategy::fair_value_cents(home_fv);

                if !is_replay {
                    vt.push(home_fv, Instant::now());
                }
                let velocity_score = vt.score();

                if let Some(mkt) = matcher::find_match(
                    market_index,
                    sport,
                    &lookup_home,
                    &lookup_away,
                    date,
                ) {
                    let fair = home_cents;

                    let key_check = matcher::generate_key(sport, &lookup_home, &lookup_away, date);
                    let game_check = key_check.and_then(|k| market_index.get(&k));
                    let side_market = game_check.and_then(|g| {
                        if mkt.is_inverse { g.away.as_ref() } else { g.home.as_ref() }
                    });

                    let staleness_secs = chrono::DateTime::parse_from_rfc3339(&bm.last_update)
                        .ok()
                        .map(|dt| {
                            let age = now_utc - dt.with_timezone(&chrono::Utc);
                            age.num_seconds().max(0) as u64
                        });

                    match evaluate_matched_market(
                        &mkt.ticker, fair, mkt.best_bid, mkt.best_ask, mkt.is_inverse,
                        velocity_score, staleness_secs, false, side_market, now_utc,
                        live_book_engine, strategy_config, momentum_config,
                        book_pressure_trackers, scorer, sim_mode, state_tx, cycle_start,
                        "odds_api", sim_config,
                    ) {
                        EvalOutcome::Closed => { filter_closed += 1; }
                        EvalOutcome::Evaluated(row) => {
                            filter_live += 1;
                            rows.insert(mkt.ticker.clone(), row);
                        }
                    }
                }
            }
        }
    }

    SportProcessResult { filter_live, filter_pre_game, filter_closed, earliest_commence, rows }
}

#[tokio::main]
async fn main() -> Result<()> {
    let log_file = std::fs::File::create("kalshi-arb.log")?;
    tracing_subscriber::fmt()
        .with_env_filter("kalshi_arb=warn")
        .with_writer(log_file)
        .init();

    let sim_mode = std::env::args().any(|arg| arg == "--simulate");

    let config = Config::load(Path::new("config.toml"))?;

    // Load saved keys from .env (real env vars take precedence)
    Config::load_env_file();

    // --- Startup: collect API keys (env vars, .env, or interactive prompt) ---
    println!();
    println!("  Kalshi Arb Engine v0.1.0");
    println!("  ========================");
    println!();
    println!("  Loading API credentials (.env / env vars / interactive prompt):");
    println!();

    if sim_mode {
        println!("  ** SIMULATION MODE ** ($1000 virtual balance)");
        println!();
    }

    let kalshi_api_key = Config::kalshi_api_key()?;
    let pk_pem = Config::kalshi_private_key_pem()?;
    let odds_api_key = Config::odds_api_key()?;

    println!();
    println!("  All keys loaded. Starting engine...");
    println!();

    let auth = Arc::new(KalshiAuth::new(kalshi_api_key, &pk_pem)?);
    let rest = Arc::new(KalshiRest::new(auth.clone(), &config.kalshi.api_base));

    // Channels
    let (state_tx, state_rx) = watch::channel({
        let mut s = AppState::new();
        s.sim_mode = sim_mode;
        s
    });
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<tui::TuiCommand>(16);
    let (kalshi_ws_tx, mut kalshi_ws_rx) = mpsc::channel(512);

    // --- Phase 1: Fetch Kalshi markets and build index ---
    let sport_series = vec![
        ("basketball", "KXNBAGAME"),
        ("american-football", "KXNFLGAME"),
        ("baseball", "KXMLBGAME"),
        ("ice-hockey", "KXNHLGAME"),
        ("college-basketball", "KXNCAAMBGAME"),
        ("college-basketball-womens", "KXNCAAWBGAME"),
        ("soccer-epl", "KXEPLGAME"),
        ("mma", "KXUFCFIGHT"),
    ];

    let mut market_index: matcher::MarketIndex = HashMap::new();
    let mut all_tickers: Vec<String> = Vec::new();

    for (sport, series) in &sport_series {
        match rest.get_markets_by_series(series).await {
            Ok(markets) => {
                for m in &markets {
                    let parsed = matcher::parse_kalshi_title(&m.title)
                        .or_else(|| matcher::parse_ufc_title(&m.title));
                    if let Some((away, home)) = parsed {
                        // Date priority: ticker (actual game date) > event_start_time > others
                        // Kalshi's expected_expiration_time/close_time are market expiry dates,
                        // NOT game dates — they can be weeks after the game.
                        let date = matcher::parse_date_from_ticker(&m.event_ticker)
                            .or_else(|| {
                                m.event_start_time.as_deref()
                                    .or(m.expected_expiration_time.as_deref())
                                    .or(m.close_time.as_deref())
                                    .and_then(|ts| {
                                        chrono::DateTime::parse_from_rfc3339(ts)
                                            .ok()
                                            .map(|dt| dt.date_naive())
                                    })
                            });

                        if let Some(date) = date {
                            if let Some(key) = matcher::generate_key(sport, &away, &home, date) {
                                // Get or create the game entry (stores both sides)
                                let game = market_index.entry(key).or_insert_with(|| {
                                    matcher::IndexedGame {
                                        away_team: away.clone(),
                                        home_team: home.clone(),
                                        ..Default::default()
                                    }
                                });

                                let side_market = matcher::SideMarket {
                                    ticker: m.ticker.clone(),
                                    title: m.title.clone(),
                                    yes_bid: kalshi::types::dollars_to_cents(m.yes_bid_dollars.as_deref()),
                                    yes_ask: kalshi::types::dollars_to_cents(m.yes_ask_dollars.as_deref()),
                                    no_bid: kalshi::types::dollars_to_cents(m.no_bid_dollars.as_deref()),
                                    no_ask: kalshi::types::dollars_to_cents(m.no_ask_dollars.as_deref()),
                                    status: m.status.clone(),
                                    close_time: m.close_time.clone(),
                                };

                                // Determine which side this market represents
                                let winner_code = m.ticker.split('-').next_back().unwrap_or("");
                                if winner_code.eq_ignore_ascii_case("TIE") {
                                    game.draw = Some(side_market);
                                } else {
                                    match matcher::is_away_market(&m.ticker, &away, &home) {
                                        Some(true) => game.away = Some(side_market),
                                        Some(false) => game.home = Some(side_market),
                                        None => {
                                            if game.away.is_none() {
                                                game.away = Some(side_market);
                                            } else {
                                                game.home = Some(side_market);
                                            }
                                        }
                                    }
                                }

                                all_tickers.push(m.ticker.clone());
                            }
                        }
                    }
                }
                tracing::debug!(sport, count = markets.len(), "indexed Kalshi markets");
            }
            Err(e) => {
                tracing::warn!(sport, error = %e, "failed to fetch Kalshi markets");
            }
        }
        // Rate-limit: avoid 429 from Kalshi API when fetching multiple series
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    tracing::debug!(total = market_index.len(), "market index built (games)");

    // Fetch initial balance
    if !sim_mode {
        match rest.get_balance().await {
            Ok(balance) => {
                state_tx.send_modify(|s| {
                    s.balance_cents = balance;
                });
                tracing::warn!("balance: {} cents (${:.2})", balance, balance as f64 / 100.0);
            }
            Err(e) => {
                tracing::error!("failed to fetch balance: {:#}", e);
            }
        }
    }

    let live_book: LiveBook = Arc::new(Mutex::new(HashMap::new()));
    let live_book_ws = live_book.clone();
    let live_book_engine = live_book.clone();

    // --- Phase 2: Spawn Kalshi WebSocket ---
    let kalshi_ws = KalshiWs::new(auth.clone(), &config.kalshi.ws_url);
    let ws_tickers = all_tickers.clone();
    tokio::spawn(async move {
        if let Err(e) = kalshi_ws.run(ws_tickers, kalshi_ws_tx).await {
            tracing::error!("kalshi WS fatal: {:#}", e);
        }
    });

    // --- Phase 3: Spawn odds polling loop ---
    let mut odds_feed = TheOddsApi::new(odds_api_key, &config.odds_feed.base_url, &config.odds_feed.bookmakers);

    // Validate API key and seed quota display before TUI starts
    match odds_feed.check_quota().await {
        Ok(quota) => {
            println!("  Odds API OK: {}/{} requests remaining",
                quota.requests_remaining,
                quota.requests_used + quota.requests_remaining,
            );
            state_tx.send_modify(|s| {
                s.api_requests_used = quota.requests_used;
                s.api_requests_remaining = quota.requests_remaining;
                s.api_burn_rate = 0.0;
                s.api_hours_remaining = f64::INFINITY;
            });
        }
        Err(e) => {
            eprintln!("  Odds API error: {:#}", e);
            std::process::exit(1);
        }
    }

    let odds_sports: Vec<String> = config.odds_feed.sports.iter()
        .filter(|s| !(config.score_feed.is_some() && s.as_str() == "basketball"))
        .cloned()
        .collect();
    let strategy_config = config.strategy.clone();
    let sim_config = config.simulation.clone().unwrap_or_default();
    let win_prob_config = config.win_prob.clone().unwrap_or_default();
    let win_prob_table = engine::win_prob::WinProbTable::from_config(&win_prob_config);
    let momentum_config = config.momentum.clone();
    let live_poll_interval = Duration::from_secs(
        config.odds_feed.live_poll_interval_s.unwrap_or(20),
    );
    let pre_game_poll_interval = Duration::from_secs(
        config.odds_feed.pre_game_poll_interval_s.unwrap_or(120),
    );
    let quota_warning_threshold = config.odds_feed.quota_warning_threshold.unwrap_or(100);

    let mut score_poller = config.score_feed.as_ref().map(|sf| {
        feed::score_feed::ScorePoller::new(
            &sf.nba_api_url,
            &sf.espn_api_url,
            sf.request_timeout_ms,
            sf.failover_threshold,
        )
    });
    let score_feed_live_interval = config.score_feed.as_ref()
        .map(|sf| Duration::from_secs(sf.live_poll_interval_s))
        .unwrap_or(Duration::from_secs(3));
    let score_feed_pre_game_interval = config.score_feed.as_ref()
        .map(|sf| Duration::from_secs(sf.pre_game_poll_interval_s))
        .unwrap_or(Duration::from_secs(60));

    let rest_for_engine = rest.clone();

    let sim_mode_engine = sim_mode;
    let state_tx_engine = state_tx.clone();
    tokio::spawn(async move {
        let mut is_paused = false;

        // Per-event velocity trackers: keyed by event_id
        let mut velocity_trackers: HashMap<String, VelocityTracker> = HashMap::new();
        // Per-ticker book pressure trackers
        let mut book_pressure_trackers: HashMap<String, BookPressureTracker> = HashMap::new();
        // Momentum scorer
        let scorer = MomentumScorer::new(
            momentum_config.velocity_weight,
            momentum_config.book_pressure_weight,
        );
        // Per-sport last poll time
        let mut last_poll: HashMap<String, Instant> = HashMap::new();
        // Per-sport commence times (to detect live games)
        let mut sport_commence_times: HashMap<String, Vec<String>> = HashMap::new();
        // Track API burn rate
        let mut api_request_times: VecDeque<Instant> = VecDeque::with_capacity(100);
        // Accumulated market rows across sports (for partial cycle updates)
        let mut accumulated_rows: HashMap<String, MarketRow> = HashMap::new();
        // Per-sport diagnostic row cache (persists across cycles so skipped/rate-limited sports retain their rows)
        let mut diagnostic_cache: HashMap<String, Vec<tui::state::DiagnosticRow>> = HashMap::new();
        // Per-sport cached odds updates (for replay on poll-skip cycles)
        let mut sport_cached_updates: HashMap<String, Vec<feed::types::OddsUpdate>> = HashMap::new();
        // Score feed state
        let mut last_score_poll: Option<Instant> = None;
        let mut last_score_fetch: HashMap<String, Instant> = HashMap::new();
        let mut score_cached_updates: Vec<feed::score_feed::ScoreUpdate> = Vec::new();

        // Filter statistics
        let mut filter_live: usize;
        let mut filter_pre_game: usize;
        let mut filter_closed: usize;
        let mut earliest_commence: Option<chrono::DateTime<chrono::Utc>>;

        loop {
            // Drain TUI commands
            while let Ok(cmd) = cmd_rx.try_recv() {
                match cmd {
                    tui::TuiCommand::Pause => {
                        is_paused = true;
                        state_tx_engine.send_modify(|s| s.is_paused = true);
                    }
                    tui::TuiCommand::Resume => {
                        is_paused = false;
                        state_tx_engine.send_modify(|s| s.is_paused = false);
                    }
                    tui::TuiCommand::Quit => return,
                    tui::TuiCommand::FetchDiagnostic => {
                        // One-shot fetch for diagnostic view
                        let mut diag_rows: Vec<tui::state::DiagnosticRow> = Vec::new();
                        for diag_sport in &odds_sports {
                            match odds_feed.fetch_odds(diag_sport).await {
                                Ok(updates) => {
                                    if let Some(quota) = odds_feed.last_quota() {
                                        api_request_times.push_back(Instant::now());
                                        let one_hour_ago = Instant::now() - Duration::from_secs(3600);
                                        while api_request_times.front().is_some_and(|&t| t < one_hour_ago) {
                                            api_request_times.pop_front();
                                        }
                                        let burn_rate = api_request_times.len() as f64;
                                        state_tx_engine.send_modify(|s| {
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
                                    let ctimes: Vec<String> = updates.iter()
                                        .map(|u| u.commence_time.clone())
                                        .collect();
                                    sport_commence_times.insert(diag_sport.to_string(), ctimes);
                                    diag_rows.extend(
                                        build_diagnostic_rows(&updates, diag_sport, &market_index)
                                    );
                                }
                                Err(e) => {
                                    tracing::warn!(sport = diag_sport.as_str(), error = %e, "diagnostic fetch failed");
                                }
                            }
                        }
                        state_tx_engine.send_modify(|s| {
                            s.diagnostic_rows = diag_rows;
                            s.diagnostic_snapshot = true;
                        });
                    }
                }
            }

            if is_paused {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            }

            let cycle_start = Instant::now();

            filter_live = 0;
            filter_pre_game = 0;
            filter_closed = 0;
            earliest_commence = None;
            accumulated_rows.clear();

            // --- Score feed for NBA (if configured) ---
            if let Some(ref mut poller) = score_poller {
                let score_interval = if score_cached_updates.iter().any(|u| u.game_status == feed::score_feed::GameStatus::Live) {
                    score_feed_live_interval
                } else {
                    score_feed_pre_game_interval
                };

                let should_fetch_scores = match last_score_poll {
                    Some(last) => cycle_start.duration_since(last) >= score_interval,
                    None => true,
                };

                if should_fetch_scores {
                    match poller.fetch().await {
                        Ok(updates) => {
                            last_score_poll = Some(Instant::now());
                            // Update staleness timestamps for ALL games returned
                            for u in &updates {
                                last_score_fetch.insert(u.game_id.clone(), Instant::now());
                            }
                            score_cached_updates = updates;
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "score feed fetch failed");
                        }
                    }
                }

                // Process score updates (fresh or cached)
                if !score_cached_updates.is_empty() {
                    let result = process_score_updates(
                        &score_cached_updates,
                        &market_index,
                        &live_book_engine,
                        &strategy_config,
                        &momentum_config,
                        &mut velocity_trackers,
                        &mut book_pressure_trackers,
                        &scorer,
                        sim_mode_engine,
                        &state_tx_engine,
                        cycle_start,
                        &last_score_fetch,
                        &sim_config,
                        &win_prob_table,
                    );

                    filter_live += result.filter_live;
                    filter_pre_game += result.filter_pre_game;
                    filter_closed += result.filter_closed;
                    if let Some(ec) = result.earliest_commence {
                        earliest_commence = Some(earliest_commence.map_or(ec, |e| e.min(ec)));
                    }
                    accumulated_rows.extend(result.rows);
                }
            }

            for sport in &odds_sports {
                // Determine if any event in this sport is live
                let is_live = sport_commence_times.get(sport.as_str()).is_some_and(|times| {
                    let now = chrono::Utc::now();
                    times.iter().any(|ct| {
                        chrono::DateTime::parse_from_rfc3339(ct)
                            .ok()
                            .is_some_and(|dt| dt < now)
                    })
                });

                // Pre-check: does this sport have any game that COULD be live?
                // Skip the API call entirely if all games are pre-game or closed.
                let now_utc_precheck = chrono::Utc::now();
                let sport_key_normalized: String = sport.to_uppercase().chars().filter(|c| c.is_ascii_alphabetic()).collect();
                let sport_has_eligible_games = market_index.iter().any(|(key, game)| {
                    if key.sport != sport_key_normalized {
                        return false;
                    }
                    // Check if any side market is open
                    let sides = [game.home.as_ref(), game.away.as_ref(), game.draw.as_ref()];
                    sides.iter().any(|s| {
                        s.is_some_and(|sm| {
                            (sm.status == "open" || sm.status == "active")
                                && sm.close_time.as_deref()
                                    .and_then(|ct| chrono::DateTime::parse_from_rfc3339(ct).ok())
                                    .is_none_or(|ct| ct.with_timezone(&chrono::Utc) > now_utc_precheck)
                        })
                    })
                });

                if !sport_has_eligible_games {
                    // Still count these games for filter stats
                    let sport_game_count = market_index.keys()
                        .filter(|k| k.sport == sport_key_normalized)
                        .count();
                    filter_closed += sport_game_count;
                    continue;
                }

                // Check if quota is critically low — force pre-game interval
                let quota_low = !api_request_times.is_empty()
                    && state_tx_engine.borrow().api_requests_remaining < quota_warning_threshold;
                let interval = if quota_low || !is_live {
                    pre_game_poll_interval
                } else {
                    live_poll_interval
                };

                // Determine if we should fetch fresh data or replay cached
                let should_fetch = match last_poll.get(sport.as_str()) {
                    Some(&last) => cycle_start.duration_since(last) >= interval,
                    None => true,
                };

                if should_fetch {
                    match odds_feed.fetch_odds(sport).await {
                        Ok(updates) => {
                            last_poll.insert(sport.to_string(), Instant::now());

                            // Store commence times for live detection
                            let ctimes: Vec<String> = updates.iter()
                                .map(|u| u.commence_time.clone())
                                .collect();
                            sport_commence_times.insert(sport.to_string(), ctimes);

                            // Update API quota
                            if let Some(quota) = odds_feed.last_quota() {
                                api_request_times.push_back(Instant::now());
                                let one_hour_ago = Instant::now() - Duration::from_secs(3600);
                                while api_request_times.front().is_some_and(|&t| t < one_hour_ago) {
                                    api_request_times.pop_front();
                                }
                                let burn_rate = api_request_times.len() as f64;

                                state_tx_engine.send_modify(|s| {
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

                            // Build diagnostic rows (only on fresh fetch)
                            diagnostic_cache.insert(
                                sport.to_string(),
                                build_diagnostic_rows(&updates, sport, &market_index),
                            );

                            // Cache updates for replay
                            sport_cached_updates.insert(sport.to_string(), updates);
                        }
                        Err(e) => {
                            tracing::warn!(sport, error = %e, "odds fetch failed");
                        }
                    }
                }

                // Process updates (fresh or cached)
                if let Some(updates) = sport_cached_updates.get(sport.as_str()) {
                    let result = process_sport_updates(
                        updates,
                        sport,
                        &market_index,
                        &live_book_engine,
                        &strategy_config,
                        &momentum_config,
                        &mut velocity_trackers,
                        &mut book_pressure_trackers,
                        &scorer,
                        sim_mode_engine,
                        &state_tx_engine,
                        cycle_start,
                        !should_fetch,
                        &sim_config,
                    );

                    filter_live += result.filter_live;
                    filter_pre_game += result.filter_pre_game;
                    filter_closed += result.filter_closed;
                    if let Some(ec) = result.earliest_commence {
                        earliest_commence = Some(earliest_commence.map_or(ec, |e| e.min(ec)));
                    }
                    accumulated_rows.extend(result.rows);
                }
            }

            // If nothing is live, sleep until the next game starts
            if filter_live == 0 {
                if let Some(next_start) = earliest_commence {
                    let now_utc = chrono::Utc::now();
                    if next_start > now_utc {
                        let wait = (next_start - now_utc).to_std().unwrap_or(Duration::from_secs(5));
                        // Cap at pre_game_poll_interval to allow index refresh
                        let capped_wait = wait.min(pre_game_poll_interval);

                        // Update TUI state before sleeping (so countdown is visible)
                        let live_sports_empty: Vec<String> = Vec::new();
                        state_tx_engine.send_modify(|state| {
                            state.markets = Vec::new();
                            state.live_sports = live_sports_empty;
                            state.filter_stats = tui::state::FilterStats {
                                live: filter_live,
                                pre_game: filter_pre_game,
                                closed: filter_closed,
                            };
                            state.next_game_start = earliest_commence;
                            state.diagnostic_rows = diagnostic_cache.values().flatten().cloned().collect();
                            state.diagnostic_snapshot = false;
                        });

                        // Sleep but wake early on TUI commands
                        tokio::select! {
                            _ = tokio::time::sleep(capped_wait) => {}
                            Some(cmd) = cmd_rx.recv() => {
                                match cmd {
                                    tui::TuiCommand::Pause => {
                                        is_paused = true;
                                        state_tx_engine.send_modify(|s| s.is_paused = true);
                                    }
                                    tui::TuiCommand::Resume => {
                                        is_paused = false;
                                        state_tx_engine.send_modify(|s| s.is_paused = false);
                                    }
                                    tui::TuiCommand::Quit => return,
                                    tui::TuiCommand::FetchDiagnostic => {
                                        // One-shot fetch for diagnostic view (during idle sleep)
                                        let mut diag_rows: Vec<tui::state::DiagnosticRow> = Vec::new();
                                        for diag_sport in &odds_sports {
                                            match odds_feed.fetch_odds(diag_sport).await {
                                                Ok(updates) => {
                                                    if let Some(quota) = odds_feed.last_quota() {
                                                        api_request_times.push_back(Instant::now());
                                                        let one_hour_ago = Instant::now() - Duration::from_secs(3600);
                                                        while api_request_times.front().is_some_and(|&t| t < one_hour_ago) {
                                                            api_request_times.pop_front();
                                                        }
                                                        let burn_rate = api_request_times.len() as f64;
                                                        state_tx_engine.send_modify(|s| {
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
                                                    let ctimes: Vec<String> = updates.iter()
                                                        .map(|u| u.commence_time.clone())
                                                        .collect();
                                                    sport_commence_times.insert(diag_sport.to_string(), ctimes);
                                                    diag_rows.extend(
                                                        build_diagnostic_rows(&updates, diag_sport, &market_index)
                                                    );
                                                }
                                                Err(e) => {
                                                    tracing::warn!(sport = diag_sport.as_str(), error = %e, "diagnostic fetch failed");
                                                }
                                            }
                                        }
                                        state_tx_engine.send_modify(|s| {
                                            s.diagnostic_rows = diag_rows;
                                            s.diagnostic_snapshot = true;
                                        });
                                    }
                                }
                            }
                        }
                        continue; // restart loop (re-check everything)
                    }
                }
            }

            // Collect accumulated rows, sort by momentum descending then edge
            let mut market_rows: Vec<MarketRow> = accumulated_rows.values().cloned().collect();
            market_rows.sort_by(|a, b| {
                b.momentum_score.partial_cmp(&a.momentum_score)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| b.edge.cmp(&a.edge))
            });

            // Update TUI state with live sports info
            let mut live_sports: Vec<String> = sport_commence_times.iter()
                .filter(|(_, times)| {
                    let now = chrono::Utc::now();
                    times.iter().any(|ct| {
                        chrono::DateTime::parse_from_rfc3339(ct)
                            .ok()
                            .is_some_and(|dt| dt < now)
                    })
                })
                .map(|(sport, _)| sport.clone())
                .collect();

            // Add basketball to live_sports if score feed has live games
            if score_poller.is_some()
                && score_cached_updates.iter().any(|u| u.game_status == feed::score_feed::GameStatus::Live)
                && !live_sports.contains(&"basketball".to_string())
            {
                live_sports.push("basketball".to_string());
            }

            state_tx_engine.send_modify(|state| {
                state.markets = market_rows;
                state.live_sports = live_sports;
                state.filter_stats = tui::state::FilterStats {
                    live: filter_live,
                    pre_game: filter_pre_game,
                    closed: filter_closed,
                };
                state.next_game_start = earliest_commence;
                state.diagnostic_rows = diagnostic_cache.values().flatten().cloned().collect();
                state.diagnostic_snapshot = false;
            });

            // Refresh balance each cycle
            if !sim_mode_engine {
                if let Ok(balance) = rest_for_engine.get_balance().await {
                    state_tx_engine.send_modify(|s| {
                        s.balance_cents = balance;
                    });
                }
            }

            // Short sleep — must be <= shortest poll interval (score feed)
            // so score updates are evaluated promptly after fetch.
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });

    // --- Phase 4: Process Kalshi WS events (update orderbook) ---
    let sim_mode_ws = sim_mode;
    let state_tx_ws = state_tx.clone();
    tokio::spawn(async move {
        while let Some(event) = kalshi_ws_rx.recv().await {
            match event {
                kalshi::ws::KalshiWsEvent::Connected => {
                    state_tx_ws.send_modify(|s| {
                        s.kalshi_ws_connected = true;
                        s.push_log("WARN", "Kalshi WS connected".to_string());
                    });
                }
                kalshi::ws::KalshiWsEvent::Disconnected(reason) => {
                    state_tx_ws.send_modify(|s| {
                        s.kalshi_ws_connected = false;
                        s.push_log("WARN", format!("Kalshi WS disconnected: {}", reason));
                    });
                }
                kalshi::ws::KalshiWsEvent::Snapshot(snap) => {
                    // Build DepthBook from snapshot and derive best bid/ask
                    let mut depth = DepthBook::new();
                    depth.apply_snapshot(&snap);
                    let (yes_bid, _yes_ask, _no_bid, _no_ask) = depth.best_bid_ask();

                    if let Ok(mut book) = live_book_ws.lock() {
                        book.insert(snap.market_ticker.clone(), depth);
                    }

                    // Sim fill detection: check if any sim position's sell is filled
                    if sim_mode_ws {
                        let ticker = snap.market_ticker.clone();
                        state_tx_ws.send_modify(|s| {
                            let mut filled_indices = Vec::new();
                            for (i, pos) in s.sim_positions.iter().enumerate() {
                                if pos.ticker == ticker && yes_bid >= pos.sell_price {
                                    filled_indices.push(i);
                                }
                            }
                            for &i in filled_indices.iter().rev() {
                                let pos = s.sim_positions.remove(i);
                                let exit_revenue = (pos.quantity * pos.sell_price) as i64;
                                let exit_fee = calculate_fee(pos.sell_price, pos.quantity, false) as i64;
                                let entry_cost = (pos.quantity * pos.entry_price) as i64 + pos.entry_fee as i64;
                                let pnl = (exit_revenue - exit_fee) - entry_cost;

                                s.sim_balance_cents += exit_revenue - exit_fee;
                                s.sim_realized_pnl_cents += pnl;
                                s.sim_total_trades += 1;
                                if pnl > 0 {
                                    s.sim_winning_trades += 1;
                                }
                                s.push_trade(tui::state::TradeRow {
                                    time: chrono::Local::now().format("%H:%M:%S").to_string(),
                                    action: "SELL".to_string(),
                                    ticker: pos.ticker.clone(),
                                    price: pos.sell_price,
                                    quantity: pos.quantity,
                                    order_type: "SIM".to_string(),
                                    pnl: Some(pnl as i32),
                                    slippage: None,
                                });
                                s.push_log("TRADE", format!(
                                    "SIM SELL {}x {} @ {}¢, P&L: {:+}¢",
                                    pos.quantity, pos.ticker, pos.sell_price, pnl
                                ));
                            }
                        });
                    }
                }
                kalshi::ws::KalshiWsEvent::Delta(delta) => {
                    let ticker = delta.market_ticker.clone();

                    // Apply delta to depth book
                    if let Ok(mut book) = live_book_ws.lock() {
                        let depth = book.entry(ticker.clone()).or_insert_with(DepthBook::new);
                        if let Some(ref pd) = delta.price_dollars {
                            depth.apply_delta_dollars(&delta.side, pd, delta.delta);
                        } else if delta.price > 0 {
                            depth.apply_delta(&delta.side, delta.price, delta.delta);
                        }
                    }

                    // Sim fill detection (existing logic)
                    if sim_mode_ws {
                        let yes_bid = if let Ok(book) = live_book_ws.lock() {
                            book.get(&ticker).map(|d| d.best_bid_ask().0).unwrap_or(0)
                        } else { 0 };

                        state_tx_ws.send_modify(|s| {
                            let mut filled_indices = Vec::new();
                            for (i, pos) in s.sim_positions.iter().enumerate() {
                                if pos.ticker == ticker && yes_bid >= pos.sell_price {
                                    filled_indices.push(i);
                                }
                            }
                            for &i in filled_indices.iter().rev() {
                                let pos = s.sim_positions.remove(i);
                                let exit_revenue = (pos.quantity * pos.sell_price) as i64;
                                let exit_fee = calculate_fee(pos.sell_price, pos.quantity, false) as i64;
                                let entry_cost = (pos.quantity * pos.entry_price) as i64 + pos.entry_fee as i64;
                                let pnl = (exit_revenue - exit_fee) - entry_cost;

                                s.sim_balance_cents += exit_revenue - exit_fee;
                                s.sim_realized_pnl_cents += pnl;
                                s.sim_total_trades += 1;
                                if pnl > 0 {
                                    s.sim_winning_trades += 1;
                                }
                                s.push_trade(tui::state::TradeRow {
                                    time: chrono::Local::now().format("%H:%M:%S").to_string(),
                                    action: "SELL".to_string(),
                                    ticker: pos.ticker.clone(),
                                    price: pos.sell_price,
                                    quantity: pos.quantity,
                                    order_type: "SIM".to_string(),
                                    pnl: Some(pnl as i32),
                                    slippage: None,
                                });
                                s.push_log("TRADE", format!(
                                    "SIM SELL {}x {} @ {}¢, P&L: {:+}¢",
                                    pos.quantity, pos.ticker, pos.sell_price, pnl
                                ));
                            }
                        });
                    }
                }
            }
        }
    });

    // --- Phase 4b: WS display refresh tick (200ms) ---
    // Patches Bid/Ask/Edge on existing MarketRows from live orderbook
    // so the TUI updates at near-WebSocket speed between odds poll cycles.
    let live_book_display = live_book.clone();
    let state_tx_display = state_tx.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            // Project best bid/ask from depth books and release the lock immediately
            let snapshot: HashMap<String, (u32, u32, u32, u32)> = if let Ok(book) = live_book_display.lock() {
                book.iter().map(|(k, v)| (k.clone(), v.best_bid_ask())).collect()
            } else {
                continue;
            };
            if snapshot.is_empty() {
                continue;
            }
            state_tx_display.send_modify(|state| {
                state.live_book = snapshot.clone();
                for row in &mut state.markets {
                    if let Some(&(yb, ya, _, _)) = snapshot.get(&row.ticker) {
                        if ya > 0 {
                            row.bid = yb;
                            row.ask = ya;
                            row.edge = row.fair_value as i32 - ya as i32;
                        }
                    }
                }
            });
        }
    });

    // --- Phase 5: Run TUI (blocks until quit) ---
    tui::run_tui(state_rx, cmd_tx).await?;

    tracing::debug!("shutting down");
    Ok(())
}

#[cfg(test)]
mod depth_book_tests {
    use super::*;

    #[test]
    fn test_empty_book_returns_zeros() {
        let book = DepthBook::new();
        assert_eq!(book.best_bid_ask(), (0, 0, 0, 0));
    }

    #[test]
    fn test_snapshot_dollar_format() {
        let mut book = DepthBook::new();
        let snap = kalshi::types::OrderbookSnapshot {
            market_ticker: "TEST".into(),
            yes: vec![],
            no: vec![],
            yes_dollars: vec![
                ("0.5500".into(), 10),
                ("0.5400".into(), 20),
            ],
            no_dollars: vec![
                ("0.4800".into(), 5),
                ("0.4700".into(), 15),
            ],
        };
        book.apply_snapshot(&snap);
        assert_eq!(book.best_bid_ask(), (55, 52, 48, 45));
    }

    #[test]
    fn test_snapshot_legacy_cent_format() {
        let mut book = DepthBook::new();
        let snap = kalshi::types::OrderbookSnapshot {
            market_ticker: "TEST".into(),
            yes: vec![[60, 10], [58, 20]],
            no: vec![[42, 5]],
            yes_dollars: vec![],
            no_dollars: vec![],
        };
        book.apply_snapshot(&snap);
        assert_eq!(book.best_bid_ask(), (60, 58, 42, 40));
    }

    #[test]
    fn test_snapshot_replaces_previous() {
        let mut book = DepthBook::new();
        let snap1 = kalshi::types::OrderbookSnapshot {
            market_ticker: "TEST".into(),
            yes: vec![], no: vec![],
            yes_dollars: vec![("0.9000".into(), 10)],
            no_dollars: vec![("0.1500".into(), 5)],
        };
        book.apply_snapshot(&snap1);
        assert_eq!(book.best_bid_ask().0, 90);

        let snap2 = kalshi::types::OrderbookSnapshot {
            market_ticker: "TEST".into(),
            yes: vec![], no: vec![],
            yes_dollars: vec![("0.5000".into(), 10)],
            no_dollars: vec![("0.5200".into(), 5)],
        };
        book.apply_snapshot(&snap2);
        assert_eq!(book.best_bid_ask().0, 50);
    }

    #[test]
    fn test_delta_adds_quantity() {
        let mut book = DepthBook::new();
        let snap = kalshi::types::OrderbookSnapshot {
            market_ticker: "TEST".into(),
            yes: vec![], no: vec![],
            yes_dollars: vec![("0.5000".into(), 10)],
            no_dollars: vec![("0.5200".into(), 5)],
        };
        book.apply_snapshot(&snap);
        book.apply_delta("yes", 55, 20);
        let (yb, _, _, _) = book.best_bid_ask();
        assert_eq!(yb, 55);
    }

    #[test]
    fn test_delta_removes_level_at_zero() {
        let mut book = DepthBook::new();
        let snap = kalshi::types::OrderbookSnapshot {
            market_ticker: "TEST".into(),
            yes: vec![], no: vec![],
            yes_dollars: vec![("0.5500".into(), 10), ("0.5000".into(), 20)],
            no_dollars: vec![("0.4800".into(), 5)],
        };
        book.apply_snapshot(&snap);
        assert_eq!(book.best_bid_ask().0, 55);
        book.apply_delta("yes", 55, -10);
        assert_eq!(book.best_bid_ask().0, 50);
    }

    #[test]
    fn test_delta_dollar_format() {
        let mut book = DepthBook::new();
        let snap = kalshi::types::OrderbookSnapshot {
            market_ticker: "TEST".into(),
            yes: vec![], no: vec![],
            yes_dollars: vec![("0.5000".into(), 10)],
            no_dollars: vec![("0.5200".into(), 5)],
        };
        book.apply_snapshot(&snap);
        book.apply_delta_dollars("yes", "0.5500", 20);
        assert_eq!(book.best_bid_ask().0, 55);
    }
}
