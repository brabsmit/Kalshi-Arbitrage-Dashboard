mod config;
mod engine;
mod feed;
mod kalshi;
mod pipeline;
mod tui;

use anyhow::Result;
use config::Config;
use engine::fees::calculate_fee;
use engine::momentum::MomentumScorer;
use engine::matcher;
use feed::{draftkings::DraftKingsFeed, the_odds_api::TheOddsApi, OddsFeed};
use kalshi::{auth::KalshiAuth, rest::KalshiRest, ws::KalshiWs};
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch};
use tui::state::{AppState, MarketRow};

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
pub type LiveBook = Arc<Mutex<HashMap<String, DepthBook>>>;

/// Extract last name from a full name (for MMA fighter matching).
/// "Alex Volkanovski" -> "Volkanovski", "Benoit Saint-Denis" -> "Saint-Denis"
pub fn last_name(full_name: &str) -> &str {
    full_name.rsplit_once(' ').map_or(full_name, |(_, last)| last)
}

/// Toggle a sport pipeline's enabled state and persist to config.
fn handle_toggle_sport(
    sport_pipelines: &mut [pipeline::SportPipeline],
    config_path: &Path,
    sport_key: &str,
) {
    if let Some(pipe) = sport_pipelines.iter_mut().find(|p| p.key == sport_key) {
        pipe.enabled = !pipe.enabled;
        persist_sport_enabled(config_path, sport_key, pipe.enabled);
        tracing::info!(sport = sport_key, enabled = pipe.enabled, "sport toggled");
    }
}

/// Fetch diagnostics for all enabled odds-feed pipelines and update TUI state.
async fn handle_fetch_diagnostic(
    sport_pipelines: &mut [pipeline::SportPipeline],
    odds_sources: &mut HashMap<String, Box<dyn OddsFeed>>,
    api_request_times: &mut VecDeque<Instant>,
    state_tx: &watch::Sender<AppState>,
    market_index: &engine::matcher::MarketIndex,
) {
    let mut diag_rows: Vec<tui::state::DiagnosticRow> = Vec::new();
    for pipe in sport_pipelines.iter_mut() {
        if !pipe.enabled { continue; }
        if let Some(source) = odds_sources.get_mut(&pipe.odds_source) {
            match source.fetch_odds(&pipe.key).await {
                Ok(updates) => {
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
                    pipe.commence_times = updates.iter()
                        .map(|u| u.commence_time.clone()).collect();
                    diag_rows.extend(
                        pipeline::build_diagnostic_rows(&updates, &pipe.key, market_index)
                    );
                }
                Err(e) => {
                    tracing::warn!(sport = pipe.key.as_str(), error = %e, "diagnostic fetch failed");
                }
            }
        }
    }
    state_tx.send_modify(|s| {
        s.diagnostic_rows = diag_rows;
        s.diagnostic_snapshot = true;
    });
}

/// Persist a sport's enabled state to the config file.
fn persist_sport_enabled(config_path: &Path, sport_key: &str, enabled: bool) {
    let Ok(content) = std::fs::read_to_string(config_path) else { return };
    let Ok(mut doc) = content.parse::<toml::Value>() else { return };
    if let Some(table) = doc.as_table_mut() {
        let sports_table = table.entry("sports")
            .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
        if let Some(st) = sports_table.as_table_mut() {
            if let Some(sport) = st.get_mut(sport_key).and_then(|s| s.as_table_mut()) {
                sport.insert("enabled".to_string(), toml::Value::Boolean(enabled));
            }
        }
        let _ = std::fs::write(config_path, toml::to_string_pretty(&doc).unwrap_or_default());
    }
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

    // Determine if we need an Odds API key (any odds source uses the-odds-api?)
    let needs_odds_api = config.odds_sources.values()
        .any(|s| s.source_type == "the-odds-api");
    let odds_api_key = if needs_odds_api {
        Some(Config::odds_api_key()?)
    } else {
        std::env::var("ODDS_API_KEY").ok().filter(|k| !k.is_empty())
    };

    println!();
    println!("  All keys loaded. Starting engine...");
    println!();

    let auth = Arc::new(KalshiAuth::new(kalshi_api_key, &pk_pem)?);
    let rest = Arc::new(KalshiRest::new(auth.clone(), &config.kalshi.api_base));

    // Pre-flight: verify authentication works before proceeding
    print!("  Verifying Kalshi authentication... ");
    { use std::io::Write; std::io::stdout().flush()?; }
    match rest.preflight_auth_check().await {
        Ok(()) => println!("OK"),
        Err(e) => {
            println!("FAILED");
            anyhow::bail!("{}", e);
        }
    }
    println!();

    // Build per-sport pipelines (sorted by hotkey for deterministic order)
    let mut sport_pipelines: Vec<pipeline::SportPipeline> = Vec::new();
    let mut sport_entries: Vec<_> = config.sports.iter().collect();
    sport_entries.sort_by_key(|(_, sc)| sc.hotkey.clone());
    for (key, sport_config) in &sport_entries {
        let p = pipeline::SportPipeline::from_config(key, sport_config, &config.strategy, &config.momentum);
        sport_pipelines.push(p);
    }

    // Build sport_toggles for TUI
    let sport_toggles: Vec<(String, String, char, bool)> = sport_pipelines.iter()
        .map(|p| (p.key.clone(), p.label.clone(), p.hotkey, p.enabled))
        .collect();

    // Channels
    let (state_tx, state_rx) = watch::channel({
        let mut s = AppState::new();
        s.sim_mode = sim_mode;
        s.sport_toggles = sport_toggles;
        s
    });
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<tui::TuiCommand>(16);
    let (kalshi_ws_tx, mut kalshi_ws_rx) = mpsc::channel(512);

    // --- Phase 1: Fetch Kalshi markets and build index ---
    // Collect unique (key, series) pairs from pipelines
    let sport_series: Vec<(String, String)> = sport_pipelines.iter()
        .map(|p| (p.key.clone(), p.series.clone()))
        .collect();

    let mut market_index: matcher::MarketIndex = HashMap::new();
    let mut all_tickers: Vec<String> = Vec::new();

    for (sport, series) in &sport_series {
        match rest.get_markets_by_series(series).await {
            Ok(markets) => {
                for m in &markets {
                    let parsed = matcher::parse_kalshi_title(&m.title)
                        .or_else(|| matcher::parse_ufc_title(&m.title));
                    if let Some((away, home)) = parsed {
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
                tracing::debug!(sport = sport.as_str(), count = markets.len(), "indexed Kalshi markets");
            }
            Err(e) => {
                tracing::warn!(sport = sport.as_str(), error = %e, "failed to fetch Kalshi markets");
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

    // --- Phase 3: Build shared odds sources ---
    let mut odds_sources: HashMap<String, Box<dyn OddsFeed>> = HashMap::new();
    for (name, source_config) in &config.odds_sources {
        match source_config.source_type.as_str() {
            "the-odds-api" => {
                let key = odds_api_key.clone().expect("odds API key required");
                let base_url = source_config.base_url.as_deref()
                    .unwrap_or("https://api.the-odds-api.com");
                let bookmakers = source_config.bookmakers.as_deref()
                    .unwrap_or("draftkings,fanduel,betmgm,caesars");
                odds_sources.insert(
                    name.clone(),
                    Box::new(TheOddsApi::new(key, base_url, bookmakers)),
                );
            }
            "draftkings" => {
                let dk_config = config::DraftKingsFeedConfig {
                    live_poll_interval_s: source_config.live_poll_s,
                    pre_game_poll_interval_s: source_config.pre_game_poll_s,
                    request_timeout_ms: source_config.request_timeout_ms,
                };
                odds_sources.insert(
                    name.clone(),
                    Box::new(DraftKingsFeed::new(&dk_config)),
                );
            }
            other => {
                eprintln!("  Unknown odds source type: {}", other);
                std::process::exit(1);
            }
        }
    }

    // Validate API key and seed quota display for the-odds-api sources
    for (name, source) in &mut odds_sources {
        // Downcast to TheOddsApi to call check_quota
        let source_config = config.odds_sources.get(name);
        if source_config.is_some_and(|c| c.source_type == "the-odds-api") {
            // We need to use the trait interface; check_quota is specific to TheOddsApi.
            // For now, do a probe fetch to validate the key.
            match source.fetch_odds("basketball").await {
                Ok(_) => {
                    if let Some(quota) = source.last_quota() {
                        println!("  Odds API ({}) OK: {}/{} requests remaining",
                            name,
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
                }
                Err(e) => {
                    eprintln!("  Odds API ({}) error: {:#}", name, e);
                    std::process::exit(1);
                }
            }
        }
    }

    // Set TUI source indicator
    let source_label = if odds_sources.len() == 1 {
        let src_type = config.odds_sources.values().next()
            .map(|c| c.source_type.as_str()).unwrap_or("UNKNOWN");
        match src_type {
            "the-odds-api" => "ODDS-API",
            "draftkings" => "DK",
            _ => "UNKNOWN",
        }
    } else {
        "PER-SPORT"
    };
    state_tx.send_modify(|s| {
        s.odds_source = source_label.to_string();
    });

    let sim_config = config.simulation.clone();
    let risk_config = config.risk.clone();
    let odds_source_configs = config.odds_sources.clone();

    let rest_for_engine = rest.clone();

    let sim_mode_engine = sim_mode;
    let state_tx_engine = state_tx.clone();
    let config_path = Path::new("config.toml").to_path_buf();
    tokio::spawn(async move {
        let mut is_paused = false;

        let scorer = MomentumScorer::new(
            config.momentum.velocity_weight,
            config.momentum.book_pressure_weight,
        );

        let mut api_request_times: VecDeque<Instant> = VecDeque::with_capacity(100);
        let mut accumulated_rows: HashMap<String, MarketRow> = HashMap::new();

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
                    tui::TuiCommand::ToggleSport(sport_key) => {
                        handle_toggle_sport(&mut sport_pipelines, &config_path, &sport_key);
                    }
                    tui::TuiCommand::FetchDiagnostic => {
                        handle_fetch_diagnostic(
                            &mut sport_pipelines, &mut odds_sources,
                            &mut api_request_times, &state_tx_engine, &market_index,
                        ).await;
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

            let bankroll_cents = {
                let s = state_tx_engine.borrow();
                if sim_mode_engine { s.sim_balance_cents.max(0) as u64 } else { s.balance_cents.max(0) as u64 }
            };

            for pipeline in &mut sport_pipelines {
                if !pipeline.enabled { continue; }

                let result = pipeline.tick(
                    cycle_start,
                    &market_index,
                    &live_book_engine,
                    &mut odds_sources,
                    &scorer,
                    &risk_config,
                    &sim_config,
                    sim_mode_engine,
                    &state_tx_engine,
                    bankroll_cents,
                    &mut api_request_times,
                    &odds_source_configs,
                ).await;

                filter_live += result.filter_live;
                filter_pre_game += result.filter_pre_game;
                filter_closed += result.filter_closed;
                if let Some(ec) = result.earliest_commence {
                    earliest_commence = Some(earliest_commence.map_or(ec, |e| e.min(ec)));
                }
                accumulated_rows.extend(result.rows);
            }

            // Check if any pipeline has live games (odds-feed via filter_live,
            // score-feed via cached_scores since score-feed pipelines never
            // populate commence_times).
            let any_has_live = filter_live > 0 || sport_pipelines.iter().any(|p| {
                p.enabled && !p.cached_scores.is_empty() && p.cached_scores.iter().any(|u| {
                    u.game_status == feed::score_feed::GameStatus::Live
                })
            });

            // If nothing is live, sleep until the next game starts
            if !any_has_live {
                if let Some(next_start) = earliest_commence {
                    let now_utc = chrono::Utc::now();
                    if next_start > now_utc {
                        let wait = (next_start - now_utc).to_std().unwrap_or(Duration::from_secs(5));
                        // Cap to prevent too-long sleeps; determine shortest pre-game poll
                        let min_pre_game_poll = odds_source_configs.values()
                            .map(|c| c.pre_game_poll_s)
                            .min()
                            .unwrap_or(120);
                        let capped_wait = wait.min(Duration::from_secs(min_pre_game_poll));

                        // Update sport toggles before sleeping
                        let toggles: Vec<(String, String, char, bool)> = sport_pipelines.iter()
                            .map(|p| (p.key.clone(), p.label.clone(), p.hotkey, p.enabled))
                            .collect();

                        let live_sports_empty: Vec<String> = Vec::new();
                        let diag_rows: Vec<tui::state::DiagnosticRow> = sport_pipelines.iter()
                            .flat_map(|p| p.diagnostic_rows.clone())
                            .collect();
                        state_tx_engine.send_modify(|state| {
                            state.markets = Vec::new();
                            state.live_sports = live_sports_empty;
                            state.filter_stats = tui::state::FilterStats {
                                live: filter_live,
                                pre_game: filter_pre_game,
                                closed: filter_closed,
                            };
                            state.next_game_start = earliest_commence;
                            state.diagnostic_rows = diag_rows;
                            state.diagnostic_snapshot = false;
                            state.sport_toggles = toggles;
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
                                    tui::TuiCommand::ToggleSport(sport_key) => {
                                        handle_toggle_sport(&mut sport_pipelines, &config_path, &sport_key);
                                    }
                                    tui::TuiCommand::FetchDiagnostic => {
                                        handle_fetch_diagnostic(
                                            &mut sport_pipelines, &mut odds_sources,
                                            &mut api_request_times, &state_tx_engine, &market_index,
                                        ).await;
                                    }
                                }
                            }
                        }
                        // Force score refetch after idle sleep wakeup
                        for pipe in &mut sport_pipelines {
                            pipe.force_score_refetch = true;
                        }
                        continue; // restart loop
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

            // Build live_sports from pipeline commence times
            let mut live_sports: Vec<String> = sport_pipelines.iter()
                .filter(|p| p.enabled)
                .filter(|p| {
                    // Check if commence_times has any past game
                    p.commence_times.iter().any(|ct| {
                        chrono::DateTime::parse_from_rfc3339(ct)
                            .ok()
                            .is_some_and(|dt| dt < chrono::Utc::now())
                    })
                    // OR for score-feed sports, check cached scores
                    || p.cached_scores.iter().any(|u| {
                        u.game_status == feed::score_feed::GameStatus::Live
                    })
                })
                .map(|p| p.key.clone())
                .collect();
            live_sports.sort();
            live_sports.dedup();

            let toggles: Vec<(String, String, char, bool)> = sport_pipelines.iter()
                .map(|p| (p.key.clone(), p.label.clone(), p.hotkey, p.enabled))
                .collect();

            let diag_rows: Vec<tui::state::DiagnosticRow> = sport_pipelines.iter()
                .flat_map(|p| p.diagnostic_rows.clone())
                .collect();

            state_tx_engine.send_modify(|state| {
                state.markets = market_rows;
                state.live_sports = live_sports;
                state.filter_stats = tui::state::FilterStats {
                    live: filter_live,
                    pre_game: filter_pre_game,
                    closed: filter_closed,
                };
                state.next_game_start = earliest_commence;
                state.diagnostic_rows = diag_rows;
                state.diagnostic_snapshot = false;
                state.sport_toggles = toggles;
            });

            // Refresh balance each cycle
            if !sim_mode_engine {
                if let Ok(balance) = rest_for_engine.get_balance().await {
                    state_tx_engine.send_modify(|s| {
                        s.balance_cents = balance;
                    });
                }
            }

            // Short sleep
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
                    let mut depth = DepthBook::new();
                    depth.apply_snapshot(&snap);
                    let (yes_bid, _yes_ask, _no_bid, _no_ask) = depth.best_bid_ask();

                    if let Ok(mut book) = live_book_ws.lock() {
                        book.insert(snap.market_ticker.clone(), depth);
                    }

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
                                let (sell_source, sell_basis) = pos.trace.as_ref()
                                    .map(|t| (t.sport.clone(), pipeline::format_fair_value_basis(t)))
                                    .unwrap_or_default();
                                s.push_trade(tui::state::TradeRow {
                                    time: chrono::Local::now().format("%H:%M:%S").to_string(),
                                    action: "SELL".to_string(),
                                    ticker: pos.ticker.clone(),
                                    price: pos.sell_price,
                                    quantity: pos.quantity,
                                    order_type: "SIM".to_string(),
                                    pnl: Some(pnl as i32),
                                    slippage: None,
                                    source: sell_source,
                                    fair_value_basis: sell_basis,
                                });
                                s.push_log("TRADE", format!(
                                    "SIM SELL {}x {} @ {}c, P&L: {:+}c",
                                    pos.quantity, pos.ticker, pos.sell_price, pnl
                                ));
                            }
                        });
                    }
                }
                kalshi::ws::KalshiWsEvent::Delta(delta) => {
                    let ticker = delta.market_ticker.clone();

                    if let Ok(mut book) = live_book_ws.lock() {
                        let depth = book.entry(ticker.clone()).or_insert_with(DepthBook::new);
                        if let Some(ref pd) = delta.price_dollars {
                            depth.apply_delta_dollars(&delta.side, pd, delta.delta);
                        } else if delta.price > 0 {
                            depth.apply_delta(&delta.side, delta.price, delta.delta);
                        }
                    }

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
                                let (sell_source, sell_basis) = pos.trace.as_ref()
                                    .map(|t| (t.sport.clone(), pipeline::format_fair_value_basis(t)))
                                    .unwrap_or_default();
                                s.push_trade(tui::state::TradeRow {
                                    time: chrono::Local::now().format("%H:%M:%S").to_string(),
                                    action: "SELL".to_string(),
                                    ticker: pos.ticker.clone(),
                                    price: pos.sell_price,
                                    quantity: pos.quantity,
                                    order_type: "SIM".to_string(),
                                    pnl: Some(pnl as i32),
                                    slippage: None,
                                    source: sell_source,
                                    fair_value_basis: sell_basis,
                                });
                                s.push_log("TRADE", format!(
                                    "SIM SELL {}x {} @ {}c, P&L: {:+}c",
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
    let live_book_display = live_book.clone();
    let state_tx_display = state_tx.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
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
