# New Markets (NCAAB, EPL, UFC) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add NCAAB, EPL (3-way), and UFC/MMA markets to the Kalshi arbitrage bot.

**Architecture:** The bot fetches Kalshi markets and builds a `MarketIndex`, then polls The Odds API for fair values and evaluates trading signals. We extend each layer: feed types get `draw_odds`, strategy gets `devig_3way()`, matcher gets UFC title parsing and a `draw` field on `IndexedGame`, and `main.rs` wires up 3-way evaluation for soccer and last-name matching for MMA.

**Tech Stack:** Rust, tokio, chrono, serde, reqwest

**Worktree:** `.worktrees/new-markets` (branch `feature/new-markets`)

**Test command:** `source "$HOME/.cargo/env" 2>/dev/null; cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/.worktrees/new-markets/kalshi-arb && cargo test 2>&1`

---

### Task 1: Add `draw` field to `IndexedGame`

**Files:**
- Modify: `kalshi-arb/src/engine/matcher.rs:22-31`

**Step 1: Add the field**

In `matcher.rs`, add `draw: Option<SideMarket>` to `IndexedGame` between `home` and `away_team`:

```rust
#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
pub struct IndexedGame {
    pub away: Option<SideMarket>,
    pub home: Option<SideMarket>,
    pub draw: Option<SideMarket>,
    pub away_team: String,
    pub home_team: String,
}
```

Since `IndexedGame` derives `Default` and `draw` is `Option<SideMarket>`, it defaults to `None` — no other code breaks.

**Step 2: Run tests to verify nothing breaks**

Run: `source "$HOME/.cargo/env" 2>/dev/null; cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/.worktrees/new-markets/kalshi-arb && cargo test 2>&1`

Expected: All 25 tests pass, no compilation errors.

**Step 3: Commit**

```bash
git add kalshi-arb/src/engine/matcher.rs
git commit -m "feat(matcher): add draw field to IndexedGame for 3-way markets"
```

---

### Task 2: Add `parse_ufc_title()` with tests

**Files:**
- Modify: `kalshi-arb/src/engine/matcher.rs:150-168` (add new function after `parse_kalshi_title`)

UFC titles look like: `"Will Alex Volkanovski win the Volkanovski vs Lopes professional MMA fight scheduled for Jan 31, 2026?"`

The parser needs to extract the event fighter pair from between `"the "` and `" professional MMA fight"`, then split on `" vs "`.

**Step 1: Write the failing tests**

Add these tests inside the existing `mod tests` block (after line 316, before the closing `}`):

```rust
    #[test]
    fn test_parse_ufc_title() {
        let result = parse_ufc_title(
            "Will Alex Volkanovski win the Volkanovski vs Lopes professional MMA fight scheduled for Jan 31, 2026?"
        );
        assert_eq!(result, Some(("Volkanovski".to_string(), "Lopes".to_string())));
    }

    #[test]
    fn test_parse_ufc_title_hyphenated() {
        let result = parse_ufc_title(
            "Will Benoit Saint-Denis win the Hooker vs Saint-Denis professional MMA fight scheduled for Jan 31, 2026?"
        );
        assert_eq!(result, Some(("Hooker".to_string(), "Saint-Denis".to_string())));
    }

    #[test]
    fn test_parse_ufc_title_not_ufc() {
        let result = parse_ufc_title("Dallas Mavericks at Los Angeles Lakers Winner?");
        assert_eq!(result, None);
    }
```

**Step 2: Run tests to verify they fail**

Run: `source "$HOME/.cargo/env" 2>/dev/null; cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/.worktrees/new-markets/kalshi-arb && cargo test 2>&1`

Expected: Compilation error — `parse_ufc_title` not found.

**Step 3: Implement `parse_ufc_title`**

Add this function in `matcher.rs` after `parse_kalshi_title` (after line 168, before `is_away_market`):

```rust
/// Parse UFC/MMA title to extract fighter names from the event portion.
/// Title format: "Will X win the Fighter1 vs Fighter2 professional MMA fight scheduled for ..."
/// Returns (fighter1, fighter2) from the event portion.
pub fn parse_ufc_title(title: &str) -> Option<(String, String)> {
    let start = title.find("the ")? + 4;
    let end = title.find(" professional MMA fight")?;
    if start >= end {
        return None;
    }
    let event_part = &title[start..end];
    let (f1, f2) = event_part.split_once(" vs ")?;
    Some((f1.to_string(), f2.to_string()))
}
```

**Step 4: Run tests to verify they pass**

Run: `source "$HOME/.cargo/env" 2>/dev/null; cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/.worktrees/new-markets/kalshi-arb && cargo test 2>&1`

Expected: All tests pass including the 3 new ones (28 total).

**Step 5: Commit**

```bash
git add kalshi-arb/src/engine/matcher.rs
git commit -m "feat(matcher): add parse_ufc_title for MMA market titles"
```

---

### Task 3: Add `devig_3way()` with tests

**Files:**
- Modify: `kalshi-arb/src/engine/strategy.rs:99-114` (add new function after `devig`)

**Step 1: Write the failing test**

Add inside the existing `mod tests` block (after line 161, before closing `}`):

```rust
    #[test]
    fn test_devig_3way() {
        // Soccer-style: home -120, away +250, draw +280
        let (home, away, draw) = devig_3way(-120.0, 250.0, 280.0);
        assert!((home + away + draw - 1.0).abs() < 0.001);
        assert!(home > away); // home is favorite
        assert!(home > draw);
    }

    #[test]
    fn test_devig_3way_even() {
        // Roughly equal odds
        let (home, away, draw) = devig_3way(200.0, 200.0, 200.0);
        assert!((home - away).abs() < 0.001);
        assert!((home - draw).abs() < 0.001);
        assert!((home + away + draw - 1.0).abs() < 0.001);
    }
```

**Step 2: Run tests to verify they fail**

Run: `source "$HOME/.cargo/env" 2>/dev/null; cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/.worktrees/new-markets/kalshi-arb && cargo test 2>&1`

Expected: Compilation error — `devig_3way` not found.

**Step 3: Implement `devig_3way`**

Add this function in `strategy.rs` after the existing `devig` function (after line 109, before `fair_value_cents`):

```rust
/// Devig three-way odds (soccer: home/away/draw) to get fair probabilities.
/// Returns (home_fair_prob, away_fair_prob, draw_fair_prob).
pub fn devig_3way(home_odds: f64, away_odds: f64, draw_odds: f64) -> (f64, f64, f64) {
    let home_implied = american_to_probability(home_odds);
    let away_implied = american_to_probability(away_odds);
    let draw_implied = american_to_probability(draw_odds);
    let total = home_implied + away_implied + draw_implied;
    if total == 0.0 {
        return (1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0);
    }
    (home_implied / total, away_implied / total, draw_implied / total)
}
```

**Step 4: Run tests to verify they pass**

Run: `source "$HOME/.cargo/env" 2>/dev/null; cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/.worktrees/new-markets/kalshi-arb && cargo test 2>&1`

Expected: All tests pass including the 2 new ones (30 total).

**Step 5: Commit**

```bash
git add kalshi-arb/src/engine/strategy.rs
git commit -m "feat(strategy): add devig_3way for 3-outcome markets"
```

---

### Task 4: Add `draw_odds` to feed types and 3-way odds parsing

**Files:**
- Modify: `kalshi-arb/src/feed/types.rs:16-23`
- Modify: `kalshi-arb/src/feed/the_odds_api.rs:14-23,60-96`

**Step 1: Add `draw_odds` field to `BookmakerOdds`**

In `feed/types.rs`, add the field to `BookmakerOdds` (line 18-23):

```rust
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct BookmakerOdds {
    pub name: String,
    pub home_odds: f64,
    pub away_odds: f64,
    pub draw_odds: Option<f64>,
    pub last_update: String,
}
```

**Step 2: Update `the_odds_api.rs` — add sport key mappings**

In `the_odds_api.rs`, update `api_sport_key` (lines 15-23) to add the 3 new mappings:

```rust
fn api_sport_key(sport: &str) -> &str {
    match sport {
        "basketball" => "basketball_nba",
        "american-football" => "americanfootball_nfl",
        "baseball" => "baseball_mlb",
        "ice-hockey" => "icehockey_nhl",
        "college-basketball" => "basketball_ncaab",
        "soccer-epl" => "soccer_epl",
        "mma" => "mma_mixed_martial_arts",
        _ => sport,
    }
}
```

**Step 3: Update odds parsing to extract draw outcome**

In `the_odds_api.rs`, in the `fetch_odds` method, update the bookmaker parsing loop (around lines 67-83) to also look for the "Draw" outcome:

```rust
                if let Some(market) = h2h {
                    let home_price = market.outcomes.iter()
                        .find(|o| o.name == event.home_team)
                        .map(|o| o.price);
                    let away_price = market.outcomes.iter()
                        .find(|o| o.name == event.away_team)
                        .map(|o| o.price);
                    let draw_price = market.outcomes.iter()
                        .find(|o| o.name == "Draw")
                        .map(|o| o.price);

                    if let (Some(h), Some(a)) = (home_price, away_price) {
                        bookmaker_odds.push(BookmakerOdds {
                            name: bm.title.clone(),
                            home_odds: h,
                            away_odds: a,
                            draw_odds: draw_price,
                            last_update: bm.last_update.clone(),
                        });
                    }
                }
```

**Step 4: Run tests to verify compilation**

Run: `source "$HOME/.cargo/env" 2>/dev/null; cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/.worktrees/new-markets/kalshi-arb && cargo test 2>&1`

Expected: All 30 tests pass. No compilation errors (the only place `BookmakerOdds` is constructed is in `the_odds_api.rs` which we just updated).

**Step 5: Commit**

```bash
git add kalshi-arb/src/feed/types.rs kalshi-arb/src/feed/the_odds_api.rs
git commit -m "feat(feed): add draw_odds and new sport key mappings"
```

---

### Task 5: Config and `sport_series` wiring

**Files:**
- Modify: `kalshi-arb/config.toml:21`
- Modify: `kalshi-arb/src/main.rs:70-75`

**Step 1: Update `config.toml`**

Change line 21 from:
```toml
sports = ["basketball", "american-football", "baseball", "ice-hockey"]
```
to:
```toml
sports = ["basketball", "american-football", "baseball", "ice-hockey", "college-basketball", "soccer-epl", "mma"]
```

**Step 2: Update `sport_series` in `main.rs`**

Change lines 70-75 from:
```rust
    let sport_series = vec![
        ("basketball", "KXNBAGAME"),
        ("american-football", "KXNFLGAME"),
        ("baseball", "KXMLBGAME"),
        ("ice-hockey", "KXNHLGAME"),
    ];
```
to:
```rust
    let sport_series = vec![
        ("basketball", "KXNBAGAME"),
        ("american-football", "KXNFLGAME"),
        ("baseball", "KXMLBGAME"),
        ("ice-hockey", "KXNHLGAME"),
        ("college-basketball", "KXNCAABGAME"),
        ("soccer-epl", "KXEPLGAME"),
        ("mma", "KXUFCFIGHT"),
    ];
```

**Step 3: Run tests to verify compilation**

Run: `source "$HOME/.cargo/env" 2>/dev/null; cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/.worktrees/new-markets/kalshi-arb && cargo test 2>&1`

Expected: All 30 tests pass.

**Step 4: Commit**

```bash
git add kalshi-arb/config.toml kalshi-arb/src/main.rs
git commit -m "feat: add NCAAB, EPL, and UFC to config and sport_series"
```

---

### Task 6: Market indexing for draw/TIE and UFC titles

**Files:**
- Modify: `kalshi-arb/src/main.rs:83-134`

This task updates the Phase 1 indexing loop to:
1. Try `parse_ufc_title` as fallback when `parse_kalshi_title` returns None
2. Detect TIE winner codes and store in `game.draw`

**Step 1: Update the title parsing to try UFC fallback**

In `main.rs`, change line 84 from:
```rust
                    if let Some((away, home)) = matcher::parse_kalshi_title(&m.title) {
```
to:
```rust
                    let parsed = matcher::parse_kalshi_title(&m.title)
                        .or_else(|| matcher::parse_ufc_title(&m.title));
                    if let Some((away, home)) = parsed {
```

**Step 2: Update side assignment to handle TIE**

In `main.rs`, replace lines 120-132 (the match block for `is_away_market`) with:

```rust
                                // Determine which side this market represents
                                let winner_code = m.ticker.split('-').last().unwrap_or("");
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
```

**Step 3: Run tests to verify compilation**

Run: `source "$HOME/.cargo/env" 2>/dev/null; cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/.worktrees/new-markets/kalshi-arb && cargo test 2>&1`

Expected: All 30 tests pass.

**Step 4: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat: handle UFC title parsing and TIE markets in indexing loop"
```

---

### Task 7: 3-way strategy evaluation and MMA last-name matching

**Files:**
- Modify: `kalshi-arb/src/main.rs:212-337` (the odds polling loop)

This is the most complex task. It modifies the polling loop to:
1. For MMA: use last names for market index lookup
2. For soccer: use 3-way devig and evaluate all 3 markets (home, away, draw)
3. For all other sports: keep existing behavior unchanged

**Step 1: Add a helper function for last-name extraction**

Add this at the top of `main.rs`, after the `type LiveBook` line (after line 21):

```rust
/// Extract last name from a full name (for MMA fighter matching).
/// "Alex Volkanovski" -> "Volkanovski", "Benoit Saint-Denis" -> "Saint-Denis"
fn last_name(full_name: &str) -> &str {
    full_name.rsplit_once(' ').map_or(full_name, |(_, last)| last)
}
```

**Step 2: Refactor the polling loop for 3-way and MMA support**

Replace the inner loop body in `main.rs` (lines 215-337, the `for update in updates` block) with the following. This is a significant change — the key differences are marked with comments:

```rust
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
                                let (lookup_home, lookup_away) = if sport == &"mma" {
                                    (last_name(&update.home_team).to_string(), last_name(&update.away_team).to_string())
                                } else {
                                    (update.home_team.clone(), update.away_team.clone())
                                };

                                // Check if this is a 3-way sport (soccer)
                                let is_3way = sport.starts_with("soccer");

                                if is_3way {
                                    // --- 3-way evaluation (soccer) ---
                                    let draw_odds = bm.draw_odds.unwrap_or(300.0);
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
```

**Step 3: Run tests to verify compilation**

Run: `source "$HOME/.cargo/env" 2>/dev/null; cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/.worktrees/new-markets/kalshi-arb && cargo test 2>&1`

Expected: All 30 tests pass. The main function compiles cleanly.

**Step 4: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat: wire up 3-way evaluation for soccer and MMA last-name matching"
```

---

### Task 8: Build verification and clippy

**Step 1: Run full test suite**

Run: `source "$HOME/.cargo/env" 2>/dev/null; cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/.worktrees/new-markets/kalshi-arb && cargo test 2>&1`

Expected: All 30 tests pass.

**Step 2: Run clippy for lint warnings**

Run: `source "$HOME/.cargo/env" 2>/dev/null; cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/.worktrees/new-markets/kalshi-arb && cargo clippy 2>&1`

Expected: No new warnings (existing `filled_at` warning is pre-existing).

**Step 3: Fix any issues found**

If clippy or tests report issues, fix them and commit:

```bash
git add -A
git commit -m "fix: address clippy warnings"
```
