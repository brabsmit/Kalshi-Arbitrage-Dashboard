mod config;
mod engine;
mod feed;
mod kalshi;
mod tui;

use anyhow::Result;
use config::Config;
use engine::{matcher, strategy};
use feed::{the_odds_api::TheOddsApi, OddsFeed};
use kalshi::{auth::KalshiAuth, rest::KalshiRest, ws::KalshiWs};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::{mpsc, watch};
use tui::state::{AppState, MarketRow};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("kalshi_arb=warn")
        .init();

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

    let kalshi_api_key = Config::kalshi_api_key()?;
    let pk_pem = Config::kalshi_private_key_pem()?;
    let odds_api_key = Config::odds_api_key()?;

    println!();
    println!("  All keys loaded. Starting engine...");
    println!();

    let auth = Arc::new(KalshiAuth::new(kalshi_api_key, &pk_pem)?);
    let rest = Arc::new(KalshiRest::new(auth.clone(), &config.kalshi.api_base));

    // Channels
    let (state_tx, state_rx) = watch::channel(AppState::new());
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<tui::TuiCommand>(16);
    let (kalshi_ws_tx, mut kalshi_ws_rx) = mpsc::channel(512);

    // --- Phase 1: Fetch Kalshi markets and build index ---
    let sport_series = vec![
        ("basketball", "KXNBAGAME"),
    ];

    let mut market_index: matcher::MarketIndex = HashMap::new();
    let mut all_tickers: Vec<String> = Vec::new();

    for (sport, series) in &sport_series {
        match rest.get_markets_by_series(series).await {
            Ok(markets) => {
                for m in &markets {
                    if let Some((away, home)) = matcher::parse_kalshi_title(&m.title) {
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
                                match matcher::is_away_market(&m.ticker, &away, &home) {
                                    Some(true) => game.away = Some(side_market),
                                    Some(false) => game.home = Some(side_market),
                                    None => {
                                        // Fallback: first goes to away, second to home
                                        if game.away.is_none() {
                                            game.away = Some(side_market);
                                        } else {
                                            game.home = Some(side_market);
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
    }

    tracing::debug!(total = market_index.len(), "market index built (games)");

    // Fetch initial balance
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

    // Live orderbook: ticker -> (best_yes_bid, best_yes_ask, best_no_bid, best_no_ask)
    let live_book: Arc<Mutex<HashMap<String, (u32, u32, u32, u32)>>> =
        Arc::new(Mutex::new(HashMap::new()));
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
                            // Devig using first bookmaker with valid odds
                            if let Some(bm) = update.bookmakers.first() {
                                let (home_fv, _away_fv) =
                                    strategy::devig(bm.home_odds, bm.away_odds);
                                let home_cents = strategy::fair_value_cents(home_fv);

                                // Parse game date from odds feed timestamp
                                let date = chrono::DateTime::parse_from_rfc3339(
                                    &update.commence_time,
                                )
                                .ok()
                                .map(|dt| dt.date_naive());

                                if let Some(date) = date {
                                    // Use find_match for proper home/away + inverse handling
                                    if let Some(mkt) = matcher::find_match(
                                        &market_index,
                                        sport,
                                        &update.home_team,
                                        &update.away_team,
                                        date,
                                    ) {
                                        let fair = home_cents;

                                        // Override stale REST prices with live WS prices if available
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
                                            fair,
                                            bid,
                                            ask,
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
                                            latency_ms: Some(
                                                cycle_start.elapsed().as_millis() as u64,
                                            ),
                                        });

                                        // Signal evaluation only — no order placement
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
            if let Ok(balance) = rest_for_engine.get_balance().await {
                state_tx_engine.send_modify(|s| {
                    s.balance_cents = balance;
                });
            }

            // Poll interval: 60s to stay within odds-api.io rate limits
            // Events are cached for 5 minutes, so each cycle only makes 1 odds request
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });

    // --- Phase 4: Process Kalshi WS events (update orderbook) ---
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
                    let yes_bid = snap.yes.iter()
                        .filter(|l| l[1] > 0).map(|l| l[0] as u32).max().unwrap_or(0);
                    let no_bid = snap.no.iter()
                        .filter(|l| l[1] > 0).map(|l| l[0] as u32).max().unwrap_or(0);
                    let yes_ask = if no_bid > 0 { 100 - no_bid } else { 0 };
                    let no_ask = if yes_bid > 0 { 100 - yes_bid } else { 0 };

                    if let Ok(mut book) = live_book_ws.lock() {
                        book.insert(snap.market_ticker.clone(), (yes_bid, yes_ask, no_bid, no_ask));
                    }
                }
                kalshi::ws::KalshiWsEvent::Delta(_delta) => {
                    // Delta events processed silently
                }
            }
        }
    });

    // --- Phase 5: Run TUI (blocks until quit) ---
    tui::run_tui(state_rx, cmd_tx).await?;

    tracing::debug!("shutting down");
    Ok(())
}
