# Poll-Skip Replay Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix live markets disappearing on poll-skip cycles by replaying cached odds data through the same processing pipeline.

**Architecture:** Extract the inline odds-processing block (~340 lines) from the main loop into a `process_sport_updates()` function. Cache the latest `Vec<OddsUpdate>` per sport. On poll-skip, replay cached updates through the extracted function instead of only checking commence times. Pass `is_replay` flag to skip velocity tracker pushes on cached data.

**Tech Stack:** Rust, tokio, chrono

**Worktree:** `.worktrees/fix-poll-skip-replay/`

---

### Task 1: Define `SportProcessResult` struct and `process_sport_updates` function signature

**Files:**
- Modify: `kalshi-arb/src/main.rs:19` (after the `use` block, before `type LiveBook`)

**Step 1: Add the result struct and function stub**

Insert after line 19 (`use tui::state::{AppState, MarketRow};`) and before line 21 (`type LiveBook`):

```rust
/// Results from processing one sport's odds updates.
struct SportProcessResult {
    filter_live: usize,
    filter_pre_game: usize,
    filter_closed: usize,
    earliest_commence: Option<chrono::DateTime<chrono::Utc>>,
    rows: HashMap<String, MarketRow>,
}
```

Then add the function signature after the `build_diagnostic_rows` function (currently ends around line 108). The function body will be `todo!()` for now:

```rust
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
) -> SportProcessResult {
    todo!()
}
```

**Step 2: Verify it compiles**

Run: `source "$HOME/.cargo/env" && cd kalshi-arb && cargo build 2>&1`
Expected: Compiles with warnings (the `todo!()` is fine since nothing calls it yet)

**Step 3: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "refactor: add SportProcessResult struct and process_sport_updates stub"
```

---

### Task 2: Move the processing body into `process_sport_updates`

**Files:**
- Modify: `kalshi-arb/src/main.rs`

This is the big extraction. The inline block at lines ~545–884 (the `for update in updates { ... }` loop plus the 3-way and 2-way evaluation branches) moves into the function body.

**Step 1: Fill in the function body**

Replace the `todo!()` in `process_sport_updates` with the extracted logic. Key changes from the inline version:

1. Initialize local accumulators: `filter_live`, `filter_pre_game`, `filter_closed`, `earliest_commence`, `rows`
2. The `for update in updates` loop is copied verbatim
3. Wrap velocity tracker pushes with `if !is_replay { vt.push(...); }`
4. Use `state_tx` instead of `state_tx_engine` for sim-mode state mutations
5. Return `SportProcessResult { filter_live, filter_pre_game, filter_closed, earliest_commence, rows }`

The full function body:

```rust
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

                        let market_open = (side.status == "open" || side.status == "active")
                            && side.close_time.as_deref()
                                .and_then(|ct| chrono::DateTime::parse_from_rfc3339(ct).ok())
                                .is_none_or(|ct| ct.with_timezone(&chrono::Utc) > now_utc);
                        if !market_open {
                            filter_closed += 1;
                            continue;
                        }
                        filter_live += 1;

                        let (bid, ask) = if let Ok(book) = live_book_engine.lock() {
                            if let Some(&(yb, ya, _, _)) = book.get(&side.ticker) {
                                if ya > 0 { (yb, ya) } else { (side.yes_bid, side.yes_ask) }
                            } else {
                                (side.yes_bid, side.yes_ask)
                            }
                        } else {
                            (side.yes_bid, side.yes_ask)
                        };

                        let bpt = book_pressure_trackers
                            .entry(side.ticker.clone())
                            .or_insert_with(|| BookPressureTracker::new(10));
                        if let Ok(book) = live_book_engine.lock() {
                            if let Some(&(yb, _ya, _nb, _na)) = book.get(&side.ticker) {
                                bpt.push(yb as u64, 100u64.saturating_sub(yb as u64), Instant::now());
                            }
                        }
                        let pressure_score = bpt.score();
                        let momentum = scorer.composite(velocity_score, pressure_score);

                        let signal = strategy::evaluate(
                            fair, bid, ask,
                            strategy_config.taker_edge_threshold,
                            strategy_config.maker_edge_threshold,
                            strategy_config.min_edge_after_fees,
                        );

                        let signal = strategy::momentum_gate(
                            signal,
                            momentum,
                            momentum_config.maker_momentum_threshold,
                            momentum_config.taker_momentum_threshold,
                        );

                        let action_str = match &signal.action {
                            strategy::TradeAction::TakerBuy => "TAKER",
                            strategy::TradeAction::MakerBuy { .. } => "MAKER",
                            strategy::TradeAction::Skip => "SKIP",
                        };

                        rows.insert(side.ticker.clone(), MarketRow {
                            ticker: side.ticker.clone(),
                            fair_value: fair,
                            bid,
                            ask,
                            edge: signal.edge,
                            action: action_str.to_string(),
                            latency_ms: Some(cycle_start.elapsed().as_millis() as u64),
                            momentum_score: momentum,
                        });

                        if signal.action != strategy::TradeAction::Skip {
                            tracing::warn!(
                                ticker = %side.ticker,
                                action = %action_str,
                                side = label,
                                price = signal.price,
                                edge = signal.edge,
                                net = signal.net_profit_estimate,
                                momentum = format!("{:.0}", momentum),
                                "signal detected (dry run)"
                            );
                        }

                        if sim_mode && signal.action != strategy::TradeAction::Skip {
                            let entry_price = signal.price;
                            let qty = (5000u32 / entry_price).max(1);
                            let entry_cost = (qty * entry_price) as i64;
                            let entry_fee = calculate_fee(entry_price, qty, true) as i64;
                            let total_cost = entry_cost + entry_fee;

                            let ticker_clone = side.ticker.clone();
                            state_tx.send_modify(|s| {
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
                    let market_open = side_market.is_some_and(|sm| {
                        (sm.status == "open" || sm.status == "active")
                            && sm.close_time.as_deref()
                                .and_then(|ct| chrono::DateTime::parse_from_rfc3339(ct).ok())
                                .is_none_or(|ct| ct.with_timezone(&chrono::Utc) > now_utc)
                    });
                    if !market_open {
                        filter_closed += 1;
                        continue;
                    }
                    filter_live += 1;

                    let (bid, ask) = if let Ok(book) = live_book_engine.lock() {
                        if let Some(&(yes_bid, yes_ask, _, _)) = book.get(&mkt.ticker) {
                            if yes_ask > 0 { (yes_bid, yes_ask) } else { (mkt.best_bid, mkt.best_ask) }
                        } else {
                            (mkt.best_bid, mkt.best_ask)
                        }
                    } else {
                        (mkt.best_bid, mkt.best_ask)
                    };

                    let bpt = book_pressure_trackers
                        .entry(mkt.ticker.clone())
                        .or_insert_with(|| BookPressureTracker::new(10));
                    if let Ok(book) = live_book_engine.lock() {
                        if let Some(&(yb, _ya, _nb, _na)) = book.get(&mkt.ticker) {
                            bpt.push(yb as u64, 100u64.saturating_sub(yb as u64), Instant::now());
                        }
                    }
                    let pressure_score = bpt.score();
                    let momentum = scorer.composite(velocity_score, pressure_score);

                    let signal = strategy::evaluate(
                        fair, bid, ask,
                        strategy_config.taker_edge_threshold,
                        strategy_config.maker_edge_threshold,
                        strategy_config.min_edge_after_fees,
                    );

                    let signal = strategy::momentum_gate(
                        signal,
                        momentum,
                        momentum_config.maker_momentum_threshold,
                        momentum_config.taker_momentum_threshold,
                    );

                    let action_str = match &signal.action {
                        strategy::TradeAction::TakerBuy => "TAKER",
                        strategy::TradeAction::MakerBuy { .. } => "MAKER",
                        strategy::TradeAction::Skip => "SKIP",
                    };

                    rows.insert(mkt.ticker.clone(), MarketRow {
                        ticker: mkt.ticker.clone(),
                        fair_value: fair,
                        bid,
                        ask,
                        edge: signal.edge,
                        action: action_str.to_string(),
                        latency_ms: Some(cycle_start.elapsed().as_millis() as u64),
                        momentum_score: momentum,
                    });

                    if signal.action != strategy::TradeAction::Skip {
                        tracing::warn!(
                            ticker = %mkt.ticker,
                            action = %action_str,
                            price = signal.price,
                            edge = signal.edge,
                            net = signal.net_profit_estimate,
                            inverse = mkt.is_inverse,
                            momentum = format!("{:.0}", momentum),
                            "signal detected (dry run)"
                        );
                    }

                    if sim_mode && signal.action != strategy::TradeAction::Skip {
                        let entry_price = signal.price;
                        let qty = (5000u32 / entry_price).max(1);
                        let entry_cost = (qty * entry_price) as i64;
                        let entry_fee = calculate_fee(entry_price, qty, true) as i64;
                        let total_cost = entry_cost + entry_fee;

                        state_tx.send_modify(|s| {
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

    SportProcessResult { filter_live, filter_pre_game, filter_closed, earliest_commence, rows }
}
```

**Step 2: Verify it compiles**

Run: `source "$HOME/.cargo/env" && cd kalshi-arb && cargo build 2>&1`
Expected: Compiles (function is defined but not yet called)

**Step 3: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "refactor: implement process_sport_updates function body"
```

---

### Task 3: Wire the main loop to use `process_sport_updates`

**Files:**
- Modify: `kalshi-arb/src/main.rs`

This task replaces the inline processing block and the poll-skip path with calls to `process_sport_updates`.

**Step 1: Add `sport_cached_updates` cache**

After line 356 (`let mut diagnostic_cache: ...`), add:

```rust
        // Per-sport cached odds updates (for replay on poll-skip cycles)
        let mut sport_cached_updates: HashMap<String, Vec<feed::types::OddsUpdate>> = HashMap::new();
```

**Step 2: Replace the poll-skip path (lines 484–505) and the fetch+process block (lines 507–889)**

The entire section from the throttle check through the end of the `match odds_feed.fetch_odds` block gets replaced. The new structure:

```rust
                // Determine if we should fetch fresh data or replay cached
                let should_fetch = match last_poll.get(sport.as_str()) {
                    Some(&last) => cycle_start.duration_since(last) >= interval,
                    None => true,
                };

                if should_fetch {
                    last_poll.insert(sport.to_string(), Instant::now());

                    match odds_feed.fetch_odds(sport).await {
                        Ok(updates) => {
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
                    );

                    filter_live += result.filter_live;
                    filter_pre_game += result.filter_pre_game;
                    filter_closed += result.filter_closed;
                    if let Some(ec) = result.earliest_commence {
                        earliest_commence = Some(earliest_commence.map_or(ec, |e| e.min(ec)));
                    }
                    accumulated_rows.extend(result.rows);
                }
```

This replaces **everything** between the `let interval = ...` block (line 478–482 stays) and the closing of the `for sport in &odds_sports` loop (line 890). Specifically:
- DELETE lines 484–889 (the old poll-skip path + fetch + inline processing)
- INSERT the new code above in its place

**Step 3: Verify it compiles**

Run: `source "$HOME/.cargo/env" && cd kalshi-arb && cargo build 2>&1`
Expected: Compiles successfully

**Step 4: Run tests**

Run: `source "$HOME/.cargo/env" && cd kalshi-arb && cargo test 2>&1`
Expected: All 60 tests pass

**Step 5: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "fix: replay cached odds on poll-skip to prevent live market dropout"
```

---

### Task 4: Verify compilation and run full test suite

**Files:**
- None (verification only)

**Step 1: Clean build**

Run: `source "$HOME/.cargo/env" && cd kalshi-arb && cargo build 2>&1`
Expected: Compiles with only pre-existing warnings (dead fields on MomentumConfig and SimPosition)

**Step 2: Run all tests**

Run: `source "$HOME/.cargo/env" && cd kalshi-arb && cargo test 2>&1`
Expected: `test result: ok. 60 passed; 0 failed`

**Step 3: Verify no clippy regressions**

Run: `source "$HOME/.cargo/env" && cd kalshi-arb && cargo clippy 2>&1`
Expected: No new warnings beyond existing dead_code ones

---

### Task 5: Final review and cleanup

**Files:**
- Review: `kalshi-arb/src/main.rs`

**Step 1: Verify the old poll-skip commence-time-only path is fully removed**

Search for the old pattern — there should be NO remaining `if ct_utc > now_utc { filter_pre_game += 1` block inside a `last_poll.get` check. The only place commence times are checked for pre-game counting should be inside `process_sport_updates`.

**Step 2: Verify the inline processing block (lines ~545–884) is fully removed**

The `for update in updates` loop should only exist inside `process_sport_updates`, not inline in the main loop.

**Step 3: Spot-check that `is_replay` flag is correctly wired**

- Fresh fetch path: `!should_fetch` = `false` → `is_replay = false` → velocity trackers updated
- Poll-skip path: `!should_fetch` = `true` → `is_replay = true` → velocity trackers skipped

**Step 4: Verify sim mode state_tx reference**

The extracted function uses `state_tx` (parameter name) which maps to `state_tx_engine` from the caller. Confirm this is wired correctly.
