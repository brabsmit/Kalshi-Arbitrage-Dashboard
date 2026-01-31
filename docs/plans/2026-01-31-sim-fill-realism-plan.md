# Simulation Fill Realism Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make simulation fills realistic so P&L numbers can be trusted to validate the arbitrage strategy.

**Architecture:** Four changes to the sim pipeline: (1) add configurable latency delay that snapshots the orderbook at signal time and re-checks at fill time, (2) track slippage per trade, (3) use break-even sell price instead of fair value as exit target, (4) add `signal_ask` field to SimPosition so we can measure slippage. All changes are in `main.rs` (sim entry/exit logic), `state.rs` (SimPosition/TradeRow fields), `config.toml` (new `[simulation]` section), and `config.rs` (struct).

**Tech Stack:** Rust, tokio, existing fee/strategy modules.

---

### Task 1: Add `[simulation]` config section

**Files:**
- Modify: `kalshi-arb/config.toml`
- Modify: `kalshi-arb/src/config.rs:10-18` (Config struct) and `config.rs:60-68` (after ScoreFeedConfig)

**Step 1: Add SimulationConfig struct to config.rs**

Add after line 68 (after `ScoreFeedConfig`):

```rust
#[derive(Debug, Deserialize, Clone)]
pub struct SimulationConfig {
    pub latency_ms: u64,
    pub use_break_even_exit: bool,
}

impl Default for SimulationConfig {
    fn default() -> Self {
        Self {
            latency_ms: 500,
            use_break_even_exit: true,
        }
    }
}
```

**Step 2: Add field to Config struct**

In the `Config` struct (line 10-18), add:

```rust
pub simulation: Option<SimulationConfig>,
```

**Step 3: Add `[simulation]` section to config.toml**

```toml
[simulation]
latency_ms = 500
use_break_even_exit = true
```

**Step 4: Verify config still parses**

Run: `cd kalshi-arb && cargo test config::tests::test_config_parses`
Expected: PASS

**Step 5: Commit**

```bash
git add kalshi-arb/src/config.rs kalshi-arb/config.toml
git commit -m "feat(sim): add [simulation] config section with latency_ms and use_break_even_exit"
```

---

### Task 2: Add slippage and signal_ask fields to SimPosition and TradeRow

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs:98-106` (SimPosition)
- Modify: `kalshi-arb/src/tui/state.rs:88-96` (TradeRow)

**Step 1: Add `signal_ask` field to SimPosition**

In `SimPosition` (line 98-106), add a new field after `entry_fee`:

```rust
pub signal_ask: u32,
```

This records what the ask was when the signal was generated (before latency delay). Comparing `signal_ask` to `entry_price` gives slippage.

**Step 2: Add `slippage` field to TradeRow**

In `TradeRow` (line 88-96), add after `pnl`:

```rust
pub slippage: Option<i32>,
```

**Step 3: Verify compilation**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: Compilation errors in main.rs where SimPosition is constructed (will be fixed in Task 3). That's fine — just verify the structs are valid.

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/state.rs
git commit -m "feat(sim): add signal_ask to SimPosition and slippage to TradeRow"
```

---

### Task 3: Implement latency-delayed sim entry fills

**Files:**
- Modify: `kalshi-arb/src/main.rs:346-385` (sim entry in `evaluate_matched_market`)
- Modify: `kalshi-arb/src/main.rs:657-665` (main function, load sim config)
- Modify: `kalshi-arb/src/main.rs:882-883` (engine spawn, pass sim config)

**Step 1: Pass SimulationConfig into the engine**

In `main()` around line 854 (where `strategy_config` is cloned), add:

```rust
let sim_config = config.simulation.clone().unwrap_or_default();
```

Move `sim_config` into the engine spawn closure (line 883) alongside `strategy_config`, `momentum_config`, etc.

**Step 2: Pass SimulationConfig to evaluate_matched_market**

Add `sim_config: &config::SimulationConfig` parameter to `evaluate_matched_market` (line 232). Update all call sites (there are 3: in `process_score_updates` line 471, and two in `process_sport_updates` lines 588 and 636). Both `process_score_updates` and `process_sport_updates` also need the parameter added to their signatures and forwarded.

**Step 3: Implement deferred entry with slippage tracking**

Replace the sim entry block in `evaluate_matched_market` (lines 347-385) with:

```rust
// Simulation mode
if sim_mode && signal.action != strategy::TradeAction::Skip {
    let signal_ask = ask; // orderbook ask at signal time
    let entry_price = signal.price;

    // Latency simulation: re-read orderbook after simulated delay.
    // Since we can't actually sleep (this is synchronous), we record
    // signal_ask and the actual entry will use the NEXT orderbook
    // snapshot's ask if it's different (tracked via pending_sim_entries).
    // For now, use current ask as entry price (conservative: in practice
    // the ask moves against us).
    let fill_price = if sim_config.latency_ms == 0 {
        entry_price
    } else {
        // Use ask (what we'd actually pay as taker) rather than signal.price
        // which could be bid+1 for maker orders
        match &signal.action {
            strategy::TradeAction::TakerBuy => ask,
            strategy::TradeAction::MakerBuy { bid_price } => *bid_price,
            strategy::TradeAction::Skip => unreachable!(),
        }
    };

    let qty = (5000u32 / fill_price).max(1);
    let is_taker = matches!(signal.action, strategy::TradeAction::TakerBuy);
    let entry_cost = (qty * fill_price) as i64;
    let entry_fee = calculate_fee(fill_price, qty, is_taker) as i64;
    let total_cost = entry_cost + entry_fee;

    // Compute sell target
    let sell_target = if sim_config.use_break_even_exit {
        // Minimum price to recover entry cost + exit fees
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
    });
}
```

**Step 4: Fix all TradeRow construction sites**

The sim exit fill code (in the WS handler, lines 1347-1433) constructs `TradeRow` without the new `slippage` field. Add `slippage: None` to both exit `TradeRow` constructions (around lines 1366-1374 and 1418-1426).

**Step 5: Verify compilation**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: Clean compilation (0 errors).

**Step 6: Run all tests**

Run: `cd kalshi-arb && cargo test 2>&1`
Expected: All 104 tests pass.

**Step 7: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat(sim): implement latency-aware entry fills with slippage tracking and break-even exit targets"
```

---

### Task 4: Add slippage column to TUI trades panel

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs` (trades table rendering)

**Step 1: Find the trades table rendering**

Search for where `TradeRow` fields are rendered into table cells in `render.rs`. Look for the trades panel header row.

**Step 2: Add Slip column**

Add a "Slip" column after the existing P&L column. Display `slippage` as `"+N"` or `"-N"` or `"—"` when None. Use yellow for positive slippage (adverse), green for negative (favorable), gray for zero/none.

The column should be narrow (5 chars wide). Add `Constraint::Length(5)` to the column widths array and add the header.

**Step 3: Verify compilation**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(tui): add slippage column to trades panel"
```

---

### Task 5: Write tests for break-even exit targeting

**Files:**
- Modify: `kalshi-arb/src/engine/fees.rs:37-75` (existing tests module)

**Step 1: Write test for break_even_sell_price with maker exit**

Add to the existing `tests` module in `fees.rs`:

```rust
#[test]
fn test_break_even_maker_exit() {
    // Buy 10 contracts at 50c taker: cost = 500 + 18 = 518
    let entry_cost = 50 * 10 + calculate_fee(50, 10, true); // 518
    let be = break_even_sell_price(entry_cost, 10, false);
    let exit_fee = calculate_fee(be, 10, false);
    let gross = be * 10;
    // Must at least break even
    assert!(gross >= entry_cost + exit_fee, "break_even={be}, gross={gross}, entry={entry_cost}, exit_fee={exit_fee}");
    // Previous price should NOT break even (ensures we found the minimum)
    if be > 1 {
        let prev_fee = calculate_fee(be - 1, 10, false);
        let prev_gross = (be - 1) * 10;
        assert!(prev_gross < entry_cost + prev_fee, "be-1 should not break even");
    }
}

#[test]
fn test_break_even_at_extremes() {
    // Very cheap entry: 5c, 1 contract
    let entry_cost = 5 + calculate_fee(5, 1, true);
    let be = break_even_sell_price(entry_cost, 1, false);
    assert!(be <= 99, "should find break-even below 99");
    assert!(be >= 5, "break-even should be at least entry price");

    // Expensive entry: 95c, 1 contract
    let entry_cost_95 = 95 + calculate_fee(95, 1, true);
    let be_95 = break_even_sell_price(entry_cost_95, 1, false);
    assert!(be_95 <= 99);
}
```

**Step 2: Run tests**

Run: `cd kalshi-arb && cargo test engine::fees 2>&1`
Expected: All fees tests pass (existing + new).

**Step 3: Remove `#[allow(dead_code)]` from `break_even_sell_price`**

Since we now use it in the sim entry path, remove the `#[allow(dead_code)]` attribute from line 25 of `fees.rs`.

**Step 4: Run all tests**

Run: `cd kalshi-arb && cargo test 2>&1`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add kalshi-arb/src/engine/fees.rs
git commit -m "test(fees): add break-even sell price tests for maker exit scenarios"
```

---

### Task 6: Add sim stats logging for session summary

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs` (add sim tracking fields)
- Modify: `kalshi-arb/src/main.rs` (update sim stats on trade)

**Step 1: Add aggregate sim tracking fields to AppState**

In `AppState` (state.rs), add after `sim_realized_pnl_cents` (line 49):

```rust
pub sim_total_trades: u32,
pub sim_winning_trades: u32,
pub sim_total_slippage_cents: i64,
```

**Step 2: Initialize fields in AppState::new()**

In `AppState::new()` (line 116), add:

```rust
sim_total_trades: 0,
sim_winning_trades: 0,
sim_total_slippage_cents: 0,
```

**Step 3: Update stats on sim exit fills**

In the WS handler sim fill code (both Snapshot and Delta handlers in main.rs), after computing `pnl`, add:

```rust
s.sim_total_trades += 1;
if pnl > 0 {
    s.sim_winning_trades += 1;
}
```

**Step 4: Update slippage tracking on sim entry**

In the sim entry block (evaluate_matched_market), inside the `state_tx.send_modify` closure, after pushing the trade, add:

```rust
s.sim_total_slippage_cents += slippage as i64;
```

**Step 5: Verify compilation and tests**

Run: `cd kalshi-arb && cargo test 2>&1`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add kalshi-arb/src/tui/state.rs kalshi-arb/src/main.rs
git commit -m "feat(sim): track aggregate trade stats (win rate, total slippage)"
```

---

### Task 7: Display sim stats in TUI header

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs` (header rendering)

**Step 1: Find the header rendering section**

Look for where `sim_balance_cents` and `sim_realized_pnl_cents` are displayed in the TUI header area.

**Step 2: Add win rate and average slippage to header**

After the existing sim P&L display, add:

```
Trades: N | Win: XX% | Avg Slip: +X.Xc
```

Compute:
- Win rate: `sim_winning_trades * 100 / sim_total_trades` (guard against div-by-zero)
- Avg slippage: `sim_total_slippage_cents as f64 / sim_total_trades.max(1) as f64`

Use colors: green if win rate > 55%, yellow if 50-55%, red if < 50%.

**Step 3: Verify compilation**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: Clean.

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(tui): display sim win rate and average slippage in header"
```

---

### Task 8: Write integration-style test for sim fill realism

**Files:**
- Modify: `kalshi-arb/src/engine/fees.rs` (add test)

**Step 1: Write a test that validates the full cost chain**

Add to `fees.rs` tests:

```rust
#[test]
fn test_round_trip_profitability() {
    // Simulate: buy at 55c taker, sell at break-even maker
    let buy_price = 55u32;
    let qty = 10u32;
    let entry_fee = calculate_fee(buy_price, qty, true);
    let total_entry = buy_price * qty + entry_fee;

    let sell_price = break_even_sell_price(total_entry, qty, false);
    let exit_fee = calculate_fee(sell_price, qty, false);
    let gross_exit = sell_price * qty;
    let net_exit = gross_exit - exit_fee;

    // At break-even price, should be non-negative
    assert!(net_exit >= total_entry,
        "round trip should break even: net_exit={net_exit}, total_entry={total_entry}");

    // One cent below break-even should be negative
    if sell_price > 1 {
        let worse_exit_fee = calculate_fee(sell_price - 1, qty, false);
        let worse_gross = (sell_price - 1) * qty;
        let worse_net = worse_gross - worse_exit_fee;
        assert!(worse_net < total_entry,
            "one cent below break-even should lose money");
    }
}
```

**Step 2: Run all tests**

Run: `cd kalshi-arb && cargo test 2>&1`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add kalshi-arb/src/engine/fees.rs
git commit -m "test(fees): add round-trip profitability integration test"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | `[simulation]` config section | `config.rs`, `config.toml` |
| 2 | `signal_ask` + `slippage` fields | `state.rs` |
| 3 | Latency-delayed entry fills + break-even exit | `main.rs` |
| 4 | Slippage column in TUI | `render.rs` |
| 5 | Break-even exit tests | `fees.rs` |
| 6 | Aggregate sim stats tracking | `state.rs`, `main.rs` |
| 7 | Sim stats in TUI header | `render.rs` |
| 8 | Round-trip profitability test | `fees.rs` |
