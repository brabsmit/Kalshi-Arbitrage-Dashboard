mod config;
mod engine;
mod feed;
mod kalshi;
mod tui;

use anyhow::Result;
use config::Config;
use engine::{matcher, risk::RiskManager, strategy};
use feed::{odds_api_io::OddsApiIo, OddsFeed};
use kalshi::{auth::KalshiAuth, rest::KalshiRest, ws::KalshiWs};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, watch};
use tui::state::{AppState, MarketRow};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("kalshi_arb=info")
        .init();

    let config = Config::load(Path::new("config.toml"))?;
    tracing::info!("loaded configuration");

    // Load API keys from environment
    let kalshi_api_key = Config::kalshi_api_key()?;
    let kalshi_pk_path = Config::kalshi_private_key_path()?;
    let odds_api_key = Config::odds_api_key()?;

    let pk_pem = std::fs::read_to_string(&kalshi_pk_path)?;
    let auth = Arc::new(KalshiAuth::new(kalshi_api_key, &pk_pem)?);
    let rest = Arc::new(KalshiRest::new(auth.clone(), &config.kalshi.api_base));

    // Channels
    let (state_tx, state_rx) = watch::channel(AppState::new());
    let (cmd_tx, _cmd_rx) = mpsc::channel::<tui::TuiCommand>(16);
    let (kalshi_ws_tx, mut kalshi_ws_rx) = mpsc::channel(512);

    // --- Phase 1: Fetch Kalshi markets and build index ---
    let sport_series = vec![
        ("americanfootball_nfl", "KXNFLGAME"),
        ("basketball_nba", "KXNBAGAME"),
        ("baseball_mlb", "KXMLBGAME"),
        ("icehockey_nhl", "KXNHLGAME"),
    ];

    let mut market_index: matcher::MarketIndex = HashMap::new();
    let mut all_tickers: Vec<String> = Vec::new();

    for (sport, series) in &sport_series {
        match rest.get_markets_by_series(series).await {
            Ok(markets) => {
                for m in &markets {
                    if let Some((away, home)) = matcher::parse_kalshi_title(&m.title) {
                        let date = m
                            .expected_expiration_time
                            .as_deref()
                            .or(m.close_time.as_deref())
                            .and_then(|ts| {
                                chrono::DateTime::parse_from_rfc3339(ts)
                                    .ok()
                                    .map(|dt| dt.date_naive())
                            })
                            .or_else(|| matcher::parse_date_from_ticker(&m.event_ticker));

                        if let Some(date) = date {
                            if let Some(key) = matcher::generate_key(sport, &away, &home, date) {
                                market_index.insert(
                                    key,
                                    matcher::IndexedMarket {
                                        ticker: m.ticker.clone(),
                                        title: m.title.clone(),
                                        is_inverse: false,
                                        best_bid: m.yes_bid,
                                        best_ask: m.yes_ask,
                                    },
                                );
                                all_tickers.push(m.ticker.clone());
                            }
                        }
                    }
                }
                tracing::info!(sport, count = markets.len(), "indexed Kalshi markets");
            }
            Err(e) => {
                tracing::warn!(sport, error = %e, "failed to fetch Kalshi markets");
            }
        }
    }

    tracing::info!(total = market_index.len(), "market index built");

    // --- Phase 2: Spawn Kalshi WebSocket ---
    let kalshi_ws = KalshiWs::new(auth.clone(), &config.kalshi.ws_url);
    let ws_tickers = all_tickers.clone();
    tokio::spawn(async move {
        if let Err(e) = kalshi_ws.run(ws_tickers, kalshi_ws_tx).await {
            tracing::error!("kalshi WS fatal: {:#}", e);
        }
    });

    // --- Phase 3: Spawn odds polling loop ---
    let mut odds_feed = OddsApiIo::new(odds_api_key, &config.odds_feed.base_url);
    let odds_sports = config.odds_feed.sports.clone();
    let strategy_config = config.strategy.clone();
    let risk_config = config.risk.clone();
    let rest_for_engine = rest.clone();

    let state_tx_engine = state_tx.clone();
    tokio::spawn(async move {
        let mut risk_mgr = RiskManager::new(risk_config);
        let mut _is_paused = false;

        loop {
            if _is_paused {
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
                                let _away_cents = strategy::fair_value_cents(_away_fv);

                                // Try to match home team
                                let date = chrono::DateTime::parse_from_rfc3339(
                                    &update.commence_time,
                                )
                                .ok()
                                .map(|dt| dt.date_naive());

                                if let Some(date) = date {
                                    if let Some(key) = matcher::generate_key(
                                        sport,
                                        &update.home_team,
                                        &update.away_team,
                                        date,
                                    ) {
                                        if let Some(mkt) = market_index.get(&key) {
                                            let fair = home_cents;
                                            let signal = strategy::evaluate(
                                                fair,
                                                mkt.best_bid,
                                                mkt.best_ask,
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
                                                bid: mkt.best_bid,
                                                ask: mkt.best_ask,
                                                edge: signal.edge,
                                                action: action_str.to_string(),
                                                latency_ms: Some(
                                                    cycle_start.elapsed().as_millis() as u64,
                                                ),
                                            });

                                            // Execute if actionable
                                            if signal.action != strategy::TradeAction::Skip
                                                && risk_mgr.can_trade(
                                                    &mkt.ticker,
                                                    1,
                                                    signal.price,
                                                )
                                            {
                                                let order =
                                                    kalshi::types::CreateOrderRequest {
                                                        ticker: mkt.ticker.clone(),
                                                        action: "buy".to_string(),
                                                        side: "yes".to_string(),
                                                        count: 1,
                                                        order_type: "limit".to_string(),
                                                        yes_price: Some(signal.price),
                                                        no_price: None,
                                                        client_order_id: None,
                                                    };
                                                match rest_for_engine
                                                    .create_order(&order)
                                                    .await
                                                {
                                                    Ok(_resp) => {
                                                        risk_mgr.record_buy(&mkt.ticker, 1);
                                                        tracing::info!(
                                                            ticker = mkt.ticker,
                                                            price = signal.price,
                                                            edge = signal.edge,
                                                            "order placed"
                                                        );
                                                    }
                                                    Err(e) => {
                                                        tracing::warn!(
                                                            "order failed: {:#}",
                                                            e
                                                        );
                                                    }
                                                }
                                            }
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

            // Poll interval: 10s for free tier rate limiting
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
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
                        s.push_log("INFO", "Kalshi WS connected".to_string());
                    });
                }
                kalshi::ws::KalshiWsEvent::Disconnected(reason) => {
                    state_tx_ws.send_modify(|s| {
                        s.kalshi_ws_connected = false;
                        s.push_log("WARN", format!("Kalshi WS disconnected: {}", reason));
                    });
                }
                kalshi::ws::KalshiWsEvent::Snapshot(snap) => {
                    state_tx_ws.send_modify(|s| {
                        s.push_log(
                            "INFO",
                            format!("Orderbook snapshot: {}", snap.market_ticker),
                        );
                    });
                }
                kalshi::ws::KalshiWsEvent::Delta(delta) => {
                    state_tx_ws.send_modify(|s| {
                        s.push_log(
                            "INFO",
                            format!(
                                "Delta: {} {} {:+} @ {}c",
                                delta.market_ticker, delta.side, delta.delta, delta.price
                            ),
                        );
                    });
                }
            }
        }
    });

    // --- Phase 5: Run TUI (blocks until quit) ---
    tui::run_tui(state_rx, cmd_tx).await?;

    tracing::info!("shutting down");
    Ok(())
}
