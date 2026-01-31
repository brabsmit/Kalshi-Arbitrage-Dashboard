# Fix Stale Kalshi Prices — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Kalshi bid/ask prices update in real-time by applying WebSocket delta events to the live orderbook.

**Architecture:** Replace the flat `(u32,u32,u32,u32)` tuple cache with a `DepthBook` struct that stores full orderbook depth (price→quantity maps for YES and NO sides). Snapshots replace the book; deltas adjust individual levels. Display tick derives best bid/ask each cycle.

**Tech Stack:** Rust, tokio, `HashMap<u32, i64>` for depth levels.

---

## Task 1: Add `DepthBook` struct with unit tests

**Files:**
- Modify: `src/main.rs:30-31` (replace `LiveBook` type alias)

**Step 1: Write failing tests for `DepthBook`**

Add a `#[cfg(test)] mod depth_book_tests` block at the bottom of `src/main.rs` (before the closing of the file). Write these tests:

```rust
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
        // yes_bid=55 (max yes), no_bid=48 (max no)
        // yes_ask = 100 - no_bid = 52, no_ask = 100 - yes_bid = 45
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
        // yes_bid=60, no_bid=42, yes_ask=58, no_ask=40
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

        // Add a better yes bid at 55c
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

        // Remove all quantity at 55c
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

        // Delta with price_dollars instead of price cents
        book.apply_delta_dollars("yes", "0.5500", 20);
        assert_eq!(book.best_bid_ask().0, 55);
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cargo test depth_book_tests -- --nocapture 2>&1 | head -30`
Expected: Compilation errors — `DepthBook` doesn't exist yet.

**Step 3: Implement `DepthBook` struct**

Replace the `LiveBook` type alias at line 30-31 with:

```rust
/// Per-ticker orderbook depth: price_cents → quantity for each side.
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
```

**Step 4: Run tests to verify they pass**

Run: `cargo test depth_book_tests -v`
Expected: All 7 tests PASS.

**Step 5: Run full test suite**

Run: `cargo test`
Expected: Compilation errors in Phase 4/4b handlers (they still destructure tuples). That's fine — we fix those in Tasks 2-4.

**Step 6: Commit**

```bash
git add src/main.rs
git commit -m "feat: add DepthBook struct for full orderbook depth tracking"
```

---

## Task 2: Update Phase 4 snapshot handler to use `DepthBook`

**Files:**
- Modify: `src/main.rs:1253-1316` (Phase 4 snapshot handler)

**Step 1: Replace snapshot handler**

Replace the snapshot arm (lines 1253-1316) with:

```rust
kalshi::ws::KalshiWsEvent::Snapshot(snap) => {
    let ticker = snap.market_ticker.clone();
    if let Ok(mut book) = live_book_ws.lock() {
        let depth = book.entry(ticker.clone()).or_insert_with(DepthBook::new);
        depth.apply_snapshot(&snap);
    }

    // Sim fill detection
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
```

**Step 2: Verify compilation**

Run: `cargo check 2>&1 | head -20`
Expected: May still have errors from Delta handler and display tick (Task 3 and 4).

---

## Task 3: Update Phase 4 delta handler to apply deltas to `DepthBook`

This is the key fix — deltas currently don't update prices at all.

**Files:**
- Modify: `src/main.rs:1318-1361` (Phase 4 delta handler)

**Step 1: Replace delta handler**

Replace the delta arm (lines 1318-1361) with:

```rust
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

    // Sim fill detection
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
```

**Step 2: Verify compilation**

Run: `cargo check 2>&1 | head -20`
Expected: May still have errors from display tick and engine read (Task 4).

---

## Task 4: Update display tick and engine reads to use `DepthBook`

**Files:**
- Modify: `src/main.rs:1371-1397` (Phase 4b display tick)
- Modify: `src/main.rs:183-191` (engine bid/ask read in `evaluate_matched_market`)
- Modify: `src/main.rs:197-201` (engine book pressure read in `evaluate_matched_market`)

**Step 1: Update display tick (Phase 4b)**

Replace lines 1371-1397 content inside the spawned task's loop body. The `snapshot` clone now contains `DepthBook` values, so derive bid/ask:

```rust
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
```

**Step 2: Update engine bid/ask read (lines 183-191)**

Replace:
```rust
let (bid, ask) = if let Ok(book) = live_book_engine.lock() {
    if let Some(&(yes_bid, yes_ask, _, _)) = book.get(ticker) {
        if yes_ask > 0 { (yes_bid, yes_ask) } else { (fallback_bid, fallback_ask) }
    } else {
        (fallback_bid, fallback_ask)
    }
} else {
    (fallback_bid, fallback_ask)
};
```

With:
```rust
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
```

**Step 3: Update engine book pressure read (lines 197-201)**

Replace:
```rust
if let Ok(book) = live_book_engine.lock() {
    if let Some(&(yb, _ya, _nb, _na)) = book.get(ticker) {
        bpt.push(yb as u64, 100u64.saturating_sub(yb as u64), Instant::now());
    }
}
```

With:
```rust
if let Ok(book) = live_book_engine.lock() {
    if let Some(depth) = book.get(ticker) {
        let (yb, _, _, _) = depth.best_bid_ask();
        bpt.push(yb as u64, 100u64.saturating_sub(yb as u64), Instant::now());
    }
}
```

**Step 4: Run full test suite**

Run: `cargo test`
Expected: All 98 tests pass (91 existing + 7 new `depth_book_tests`).

**Step 5: Commit**

```bash
git add src/main.rs
git commit -m "fix: apply WebSocket deltas to live orderbook so prices update in real-time

Delta events were received but never applied to live_book, causing
bid/ask prices to freeze after the initial snapshot. Now DepthBook
maintains full orderbook depth and derives best bid/ask each cycle."
```

---

## Task 5: Verify and clean up

**Step 1: Run `cargo clippy`**

Run: `cargo clippy 2>&1`
Expected: No new warnings from our changes.

**Step 2: Verify existing warnings haven't increased**

The pre-existing warnings (dead fields in `MomentumConfig`, `ScoreUpdate`, `SimPosition`) should be the only ones.

**Step 3: Final commit if any clippy fixes needed**

Only if clippy flagged something in our new code.
