mod config;
mod engine;
mod feed;
mod kalshi;
mod tui;

use anyhow::Result;
use config::Config;
use engine::fees::calculate_fee;
use engine::{matcher, strategy};
use feed::{the_odds_api::TheOddsApi, OddsFeed};
use kalshi::{auth::KalshiAuth, rest::KalshiRest, ws::KalshiWs};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::{mpsc, watch};
use tui::state::{AppState, MarketRow};

/// Live orderbook: ticker -> (best_yes_bid, best_yes_ask, best_no_bid, best_no_ask)
type LiveBook = Arc<Mutex<HashMap<String, (u32, u32, u32, u32)>>>;

/// Extract last name from a full name (for MMA fighter matching).
/// "Alex Volkanovski" -> "Volkanovski", "Benoit Saint-Denis" -> "Saint-Denis"
fn last_name(full_name: &str) -> &str {
    full_name.rsplit_once(' ').map_or(full_name, |(_, last)| last)
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
        ("college-basketball", "KXNCAABGAME"),
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
    let odds_sports = config.odds_feed.sports.clone();
    let strategy_config = config.strategy.clone();
    let rest_for_engine = rest.clone();

    let sim_mode_engine = sim_mode;
    let state_tx_engine = state_tx.clone();
    tokio::spawn(async move {
        let mut is_paused = false;

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
                }
            }

            if is_paused {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            }

            let cycle_start = Instant::now();
            let mut market_rows: Vec<MarketRow> = Vec::new();

            for sport in &odds_sports {
                match odds_feed.fetch_odds(sport).await {
                    Ok(updates) => {
                        for update in updates {
                            if let Some(bm) = update.bookmakers.first() {
                                // Parse game date from odds feed timestamp.
                                let eastern = chrono::FixedOffset::west_opt(5 * 3600).unwrap();
                                let date = chrono::DateTime::parse_from_rfc3339(
                                    &update.commence_time,
                                )
                                .ok()
                                .map(|dt| dt.with_timezone(&eastern).date_naive());

                                let Some(date) = date else { continue };

                                // MMA: use last names for matching (Kalshi indexes by last name)
                                let (lookup_home, lookup_away) = if sport == "mma" {
                                    (last_name(&update.home_team).to_string(), last_name(&update.away_team).to_string())
                                } else {
                                    (update.home_team.clone(), update.away_team.clone())
                                };

                                // Check if this is a 3-way sport (soccer)
                                let is_3way = sport.starts_with("soccer");

                                if is_3way {
                                    // --- 3-way evaluation (soccer) ---
                                    let Some(draw_odds) = bm.draw_odds else {
                                        tracing::warn!(sport, home = %update.home_team, "skipping soccer event: missing draw odds");
                                        continue;
                                    };
                                    let (home_fv, away_fv, draw_fv) =
                                        strategy::devig_3way(bm.home_odds, bm.away_odds, draw_odds);

                                    let key = matcher::generate_key(sport, &lookup_home, &lookup_away, date);
                                    let game = key.and_then(|k| market_index.get(&k));

                                    if let Some(game) = game {
                                        // Evaluate each side that exists
                                        let sides: Vec<(Option<&matcher::SideMarket>, u32, &str)> = vec![
                                            (game.home.as_ref(), strategy::fair_value_cents(home_fv), "HOME"),
                                            (game.away.as_ref(), strategy::fair_value_cents(away_fv), "AWAY"),
                                            (game.draw.as_ref(), strategy::fair_value_cents(draw_fv), "DRAW"),
                                        ];

                                        for (side_opt, fair, label) in sides {
                                            let Some(side) = side_opt else { continue };

                                            let (bid, ask) = if let Ok(book) = live_book_engine.lock() {
                                                if let Some(&(yb, ya, _, _)) = book.get(&side.ticker) {
                                                    if ya > 0 { (yb, ya) } else { (side.yes_bid, side.yes_ask) }
                                                } else {
                                                    (side.yes_bid, side.yes_ask)
                                                }
                                            } else {
                                                (side.yes_bid, side.yes_ask)
                                            };

                                            let signal = strategy::evaluate(
                                                fair, bid, ask,
                                                strategy_config.taker_edge_threshold,
                                                strategy_config.maker_edge_threshold,
                                                strategy_config.min_edge_after_fees,
                                            );

                                            let action_str = match &signal.action {
                                                strategy::TradeAction::TakerBuy => "TAKER",
                                                strategy::TradeAction::MakerBuy { .. } => "MAKER",
                                                strategy::TradeAction::Skip => "SKIP",
                                            };

                                            market_rows.push(MarketRow {
                                                ticker: side.ticker.clone(),
                                                fair_value: fair,
                                                bid,
                                                ask,
                                                edge: signal.edge,
                                                action: action_str.to_string(),
                                                latency_ms: Some(cycle_start.elapsed().as_millis() as u64),
                                            });

                                            if signal.action != strategy::TradeAction::Skip {
                                                tracing::warn!(
                                                    ticker = %side.ticker,
                                                    action = %action_str,
                                                    side = label,
                                                    price = signal.price,
                                                    edge = signal.edge,
                                                    net = signal.net_profit_estimate,
                                                    "signal detected (dry run)"
                                                );
                                            }

                                            // Sim mode: place virtual buy
                                            if sim_mode_engine && signal.action != strategy::TradeAction::Skip {
                                                let entry_price = signal.price;
                                                let qty = (5000u32 / entry_price).max(1);
                                                let entry_cost = (qty * entry_price) as i64;
                                                let entry_fee = calculate_fee(entry_price, qty, true) as i64;
                                                let total_cost = entry_cost + entry_fee;

                                                let ticker_clone = side.ticker.clone();
                                                state_tx_engine.send_modify(|s| {
                                                    if s.sim_balance_cents < total_cost {
                                                        return;
                                                    }
                                                    if s.sim_positions.iter().any(|p| p.ticker == ticker_clone) {
                                                        return;
                                                    }
                                                    s.sim_balance_cents -= total_cost;
                                                    s.sim_positions.push(tui::state::SimPosition {
                                                        ticker: ticker_clone.clone(),
                                                        quantity: qty,
                                                        entry_price,
                                                        sell_price: fair,
                                                        entry_fee: entry_fee as u32,
                                                        filled_at: std::time::Instant::now(),
                                                    });
                                                    s.push_trade(tui::state::TradeRow {
                                                        time: chrono::Local::now().format("%H:%M:%S").to_string(),
                                                        action: "BUY".to_string(),
                                                        ticker: ticker_clone.clone(),
                                                        price: entry_price,
                                                        quantity: qty,
                                                        order_type: "SIM".to_string(),
                                                        pnl: None,
                                                    });
                                                    s.push_log("TRADE", format!(
                                                        "SIM BUY {}x {} @ {}¢, sell target {}¢",
                                                        qty, ticker_clone, entry_price, fair
                                                    ));
                                                });
                                            }
                                        }
                                    }
                                } else {
                                    // --- 2-way evaluation (existing behavior) ---
                                    let (home_fv, _away_fv) =
                                        strategy::devig(bm.home_odds, bm.away_odds);
                                    let home_cents = strategy::fair_value_cents(home_fv);

                                    if let Some(mkt) = matcher::find_match(
                                        &market_index,
                                        sport,
                                        &lookup_home,
                                        &lookup_away,
                                        date,
                                    ) {
                                        let fair = home_cents;

                                        let (bid, ask) = if let Ok(book) = live_book_engine.lock() {
                                            if let Some(&(yes_bid, yes_ask, _, _)) = book.get(&mkt.ticker) {
                                                if yes_ask > 0 { (yes_bid, yes_ask) } else { (mkt.best_bid, mkt.best_ask) }
                                            } else {
                                                (mkt.best_bid, mkt.best_ask)
                                            }
                                        } else {
                                            (mkt.best_bid, mkt.best_ask)
                                        };

                                        let signal = strategy::evaluate(
                                            fair, bid, ask,
                                            strategy_config.taker_edge_threshold,
                                            strategy_config.maker_edge_threshold,
                                            strategy_config.min_edge_after_fees,
                                        );

                                        let action_str = match &signal.action {
                                            strategy::TradeAction::TakerBuy => "TAKER",
                                            strategy::TradeAction::MakerBuy { .. } => "MAKER",
                                            strategy::TradeAction::Skip => "SKIP",
                                        };

                                        market_rows.push(MarketRow {
                                            ticker: mkt.ticker.clone(),
                                            fair_value: fair,
                                            bid,
                                            ask,
                                            edge: signal.edge,
                                            action: action_str.to_string(),
                                            latency_ms: Some(cycle_start.elapsed().as_millis() as u64),
                                        });

                                        if signal.action != strategy::TradeAction::Skip {
                                            tracing::warn!(
                                                ticker = %mkt.ticker,
                                                action = %action_str,
                                                price = signal.price,
                                                edge = signal.edge,
                                                net = signal.net_profit_estimate,
                                                inverse = mkt.is_inverse,
                                                "signal detected (dry run)"
                                            );
                                        }

                                        // Sim mode: place virtual buy
                                        if sim_mode_engine && signal.action != strategy::TradeAction::Skip {
                                            let entry_price = signal.price;
                                            let qty = (5000u32 / entry_price).max(1);
                                            let entry_cost = (qty * entry_price) as i64;
                                            let entry_fee = calculate_fee(entry_price, qty, true) as i64;
                                            let total_cost = entry_cost + entry_fee;

                                            state_tx_engine.send_modify(|s| {
                                                if s.sim_balance_cents < total_cost {
                                                    return;
                                                }
                                                if s.sim_positions.iter().any(|p| p.ticker == mkt.ticker) {
                                                    return;
                                                }
                                                s.sim_balance_cents -= total_cost;
                                                s.sim_positions.push(tui::state::SimPosition {
                                                    ticker: mkt.ticker.clone(),
                                                    quantity: qty,
                                                    entry_price,
                                                    sell_price: fair,
                                                    entry_fee: entry_fee as u32,
                                                    filled_at: std::time::Instant::now(),
                                                });
                                                s.push_trade(tui::state::TradeRow {
                                                    time: chrono::Local::now().format("%H:%M:%S").to_string(),
                                                    action: "BUY".to_string(),
                                                    ticker: mkt.ticker.clone(),
                                                    price: entry_price,
                                                    quantity: qty,
                                                    order_type: "SIM".to_string(),
                                                    pnl: None,
                                                });
                                                s.push_log("TRADE", format!(
                                                    "SIM BUY {}x {} @ {}¢, sell target {}¢",
                                                    qty, mkt.ticker, entry_price, fair
                                                ));
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(sport, error = %e, "odds fetch failed");
                    }
                }
            }

            // Sort by edge descending
            market_rows.sort_by(|a, b| b.edge.cmp(&a.edge));

            // Update TUI state
            state_tx_engine.send_modify(|state| {
                state.markets = market_rows;
            });

            // Refresh balance each cycle
            if !sim_mode_engine {
                if let Ok(balance) = rest_for_engine.get_balance().await {
                    state_tx_engine.send_modify(|s| {
                        s.balance_cents = balance;
                    });
                }
            }

            // Poll interval: 60s to stay within odds-api.io rate limits
            // Events are cached for 5 minutes, so each cycle only makes 1 odds request
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
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
                    // Prefer dollar fields (current API), fall back to legacy cent fields
                    let yes_bid = if !snap.yes_dollars.is_empty() {
                        snap.yes_dollars.iter()
                            .filter(|(_, q)| *q > 0)
                            .filter_map(|(p, _)| p.parse::<f64>().ok())
                            .map(|d| (d * 100.0).round() as u32)
                            .max().unwrap_or(0)
                    } else {
                        snap.yes.iter()
                            .filter(|l| l[1] > 0).map(|l| l[0] as u32).max().unwrap_or(0)
                    };
                    let no_bid = if !snap.no_dollars.is_empty() {
                        snap.no_dollars.iter()
                            .filter(|(_, q)| *q > 0)
                            .filter_map(|(p, _)| p.parse::<f64>().ok())
                            .map(|d| (d * 100.0).round() as u32)
                            .max().unwrap_or(0)
                    } else {
                        snap.no.iter()
                            .filter(|l| l[1] > 0).map(|l| l[0] as u32).max().unwrap_or(0)
                    };
                    let yes_ask = if no_bid > 0 { 100 - no_bid } else { 0 };
                    let no_ask = if yes_bid > 0 { 100 - yes_bid } else { 0 };

                    if let Ok(mut book) = live_book_ws.lock() {
                        book.insert(snap.market_ticker.clone(), (yes_bid, yes_ask, no_bid, no_ask));
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
                                s.push_trade(tui::state::TradeRow {
                                    time: chrono::Local::now().format("%H:%M:%S").to_string(),
                                    action: "SELL".to_string(),
                                    ticker: pos.ticker.clone(),
                                    price: pos.sell_price,
                                    quantity: pos.quantity,
                                    order_type: "SIM".to_string(),
                                    pnl: Some(pnl as i32),
                                });
                                s.push_log("TRADE", format!(
                                    "SIM SELL {}x {} @ {}¢, P&L: {:+}¢",
                                    pos.quantity, pos.ticker, pos.sell_price, pnl
                                ));
                            }
                        });
                    }
                }
                kalshi::ws::KalshiWsEvent::Delta(_delta) => {
                    // Delta events: also check for sim fills using live_book
                    if sim_mode_ws {
                        if let Ok(book) = live_book_ws.lock() {
                            let book_snapshot: Vec<(String, u32)> = book.iter()
                                .map(|(t, (yb, _, _, _))| (t.clone(), *yb))
                                .collect();
                            drop(book);
                            state_tx_ws.send_modify(|s| {
                                let mut filled_indices = Vec::new();
                                for (i, pos) in s.sim_positions.iter().enumerate() {
                                    if let Some((_, best_bid)) = book_snapshot.iter().find(|(t, _)| t == &pos.ticker) {
                                        if *best_bid >= pos.sell_price {
                                            filled_indices.push(i);
                                        }
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
                                    s.push_trade(tui::state::TradeRow {
                                        time: chrono::Local::now().format("%H:%M:%S").to_string(),
                                        action: "SELL".to_string(),
                                        ticker: pos.ticker.clone(),
                                        price: pos.sell_price,
                                        quantity: pos.quantity,
                                        order_type: "SIM".to_string(),
                                        pnl: Some(pnl as i32),
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
        }
    });

    // --- Phase 5: Run TUI (blocks until quit) ---
    tui::run_tui(state_rx, cmd_tx).await?;

    tracing::debug!("shutting down");
    Ok(())
}
