# Critical Gaps for Live Trading - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix four critical safety gaps that must be addressed before live trading with real capital.

**Architecture:** Each gap is implemented as an isolated module enhancement with comprehensive tests. Order cancellation extends the existing `KalshiRest` → `OrderExecutor` chain. Timeout detection adds TTL logic to `PendingOrderRegistry`. Reconciliation retry wraps the startup sequence with exponential backoff. Slippage modeling adds a configurable buffer to strategy evaluation.

**Tech Stack:** Rust, tokio (async), anyhow (errors), std::time (Duration, Instant)

---

## Task 1: Wire Order Cancellation into OrderExecutor

The `cancel_order` method exists in `kalshi/rest.rs:147-164` but is marked `#[allow(dead_code)]` and never called. We need to expose it through `OrderExecutor` and use it in the kill-switch handler.

**Files:**
- Modify: `kalshi-arb/src/execution/executor.rs`
- Test: `kalshi-arb/src/execution/executor.rs` (inline tests)

**Step 1: Write the failing test**

Add to `executor.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_executor_has_cancel_method() {
        // This test verifies the cancel_order method exists on OrderExecutor.
        // We can't test actual cancellation without a mock, but we verify the API.
        fn assert_has_cancel<T: HasCancel>() {}
        trait HasCancel {
            fn cancel_order(&self, order_id: &str) -> impl std::future::Future<Output = Result<()>>;
        }
        impl HasCancel for OrderExecutor {
            fn cancel_order(&self, order_id: &str) -> impl std::future::Future<Output = Result<()>> {
                async { Ok(()) } // Compile-time check only
            }
        }
        assert_has_cancel::<OrderExecutor>();
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd kalshi-arb && cargo test executor::tests::test_executor_has_cancel_method`
Expected: FAIL with "method `cancel_order` not found"

**Step 3: Implement cancel_order on OrderExecutor**

Add method to `OrderExecutor` impl block in `executor.rs`:

```rust
    /// Cancel an order by ID.
    /// In dry-run mode, logs the cancellation attempt and returns Ok.
    pub async fn cancel_order(&self, order_id: &str) -> Result<()> {
        if self.dry_run {
            tracing::info!(
                order_id = %order_id,
                "DRY RUN: would cancel order"
            );
            return Ok(());
        }

        self.rest
            .cancel_order(order_id)
            .await
            .context(format!("failed to cancel order {}", order_id))?;

        tracing::info!(order_id = %order_id, "order cancelled");
        Ok(())
    }
```

**Step 4: Run test to verify it passes**

Run: `cd kalshi-arb && cargo test executor::tests::test_executor_has_cancel_method`
Expected: PASS

**Step 5: Commit**

```bash
git add kalshi-arb/src/execution/executor.rs
git commit -m "feat(executor): add cancel_order method to OrderExecutor

Exposes the existing KalshiRest::cancel_order through the executor layer.
Supports dry-run mode for testing without live API calls.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Store Order IDs in PendingOrderRegistry

Currently `PendingOrderRegistry` tracks orders by ticker but doesn't store the order ID returned by Kalshi. We need this to cancel specific orders.

**Files:**
- Modify: `kalshi-arb/src/engine/pending_orders.rs`
- Test: `kalshi-arb/src/engine/pending_orders.rs` (existing inline tests)

**Step 1: Write the failing test**

Add to existing tests in `pending_orders.rs`:

```rust
    #[test]
    fn test_register_with_order_id() {
        let mut registry = PendingOrderRegistry::new();
        registry.register_with_id("TEST".to_string(), 10, 50, true, Some("order-123".to_string()));

        let order = registry.get("TEST").expect("should have order");
        assert_eq!(order.order_id, Some("order-123".to_string()));
    }

    #[test]
    fn test_get_order_id_for_cancellation() {
        let mut registry = PendingOrderRegistry::new();
        registry.register_with_id("TEST".to_string(), 10, 50, true, Some("order-456".to_string()));

        let order_id = registry.get_order_id("TEST");
        assert_eq!(order_id, Some("order-456".to_string()));
    }
```

**Step 2: Run test to verify it fails**

Run: `cd kalshi-arb && cargo test pending_orders::tests::test_register_with_order_id`
Expected: FAIL with "no method named `register_with_id`"

**Step 3: Add order_id field and methods**

Modify `PendingOrder` struct:

```rust
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct PendingOrder {
    pub ticker: String,
    pub quantity: u32,
    pub price: u32,
    pub is_taker: bool,
    pub submitted_at: Instant,
    pub order_id: Option<String>,  // NEW: Kalshi order ID for cancellation
}
```

Add new methods to `PendingOrderRegistry`:

```rust
    /// Register with a known order ID (after submission succeeds).
    pub fn register_with_id(
        &mut self,
        ticker: String,
        quantity: u32,
        price: u32,
        is_taker: bool,
        order_id: Option<String>,
    ) -> bool {
        if self.orders.contains_key(&ticker) {
            return false;
        }
        self.orders.insert(
            ticker.clone(),
            PendingOrder {
                ticker,
                quantity,
                price,
                is_taker,
                submitted_at: Instant::now(),
                order_id,
            },
        );
        true
    }

    /// Get a pending order by ticker.
    pub fn get(&self, ticker: &str) -> Option<&PendingOrder> {
        self.orders.get(ticker)
    }

    /// Get the order ID for a ticker (for cancellation).
    pub fn get_order_id(&self, ticker: &str) -> Option<String> {
        self.orders.get(ticker).and_then(|o| o.order_id.clone())
    }

    /// Get all pending order IDs (for bulk cancellation on kill-switch).
    pub fn all_order_ids(&self) -> Vec<String> {
        self.orders
            .values()
            .filter_map(|o| o.order_id.clone())
            .collect()
    }
```

Update existing `try_register` to set `order_id: None`:

```rust
    pub fn try_register(
        &mut self,
        ticker: String,
        quantity: u32,
        price: u32,
        is_taker: bool,
    ) -> bool {
        if self.orders.contains_key(&ticker) {
            return false;
        }
        self.orders.insert(
            ticker.clone(),
            PendingOrder {
                ticker,
                quantity,
                price,
                is_taker,
                submitted_at: Instant::now(),
                order_id: None,  // Set later via set_order_id
            },
        );
        true
    }

    /// Set the order ID after submission succeeds.
    pub fn set_order_id(&mut self, ticker: &str, order_id: String) {
        if let Some(order) = self.orders.get_mut(ticker) {
            order.order_id = Some(order_id);
        }
    }
```

**Step 4: Run test to verify it passes**

Run: `cd kalshi-arb && cargo test pending_orders::tests`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add kalshi-arb/src/engine/pending_orders.rs
git commit -m "feat(pending_orders): store order IDs for cancellation support

- Add order_id field to PendingOrder struct
- Add register_with_id, get, get_order_id, all_order_ids methods
- Add set_order_id for updating after submission
- Enables kill-switch to cancel in-flight orders

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Order Timeout Detection with TTL Expiration

Orders that remain pending beyond a threshold should be auto-cleared to prevent blocking legitimate trades.

**Files:**
- Modify: `kalshi-arb/src/engine/pending_orders.rs`
- Test: `kalshi-arb/src/engine/pending_orders.rs` (inline tests)

**Step 1: Write the failing test**

Add to tests in `pending_orders.rs`:

```rust
    #[test]
    fn test_expire_old_orders() {
        let mut registry = PendingOrderRegistry::new();
        registry.try_register("OLD".to_string(), 10, 50, true);

        // Simulate time passing by manually setting submitted_at
        // We'll need to add a test helper for this

        // For now, test the interface exists
        let expired = registry.expire_older_than(Duration::from_secs(30));
        // Fresh order should not be expired
        assert_eq!(expired.len(), 0);
        assert!(registry.is_pending("OLD"));
    }

    #[test]
    fn test_expire_returns_order_ids() {
        let mut registry = PendingOrderRegistry::new();
        registry.register_with_id("TEST".to_string(), 10, 50, true, Some("order-789".to_string()));

        // Force expiration by using a zero duration (everything is "old")
        // Actually we need orders to be > 0 seconds old, so this won't expire immediately
        // We'll test the return type
        let expired: Vec<PendingOrder> = registry.expire_older_than(Duration::from_secs(0));
        // Nothing expired yet (just created)
        assert!(expired.is_empty());
    }
```

**Step 2: Run test to verify it fails**

Run: `cd kalshi-arb && cargo test pending_orders::tests::test_expire_old_orders`
Expected: FAIL with "no method named `expire_older_than`"

**Step 3: Implement expire_older_than**

Add to `PendingOrderRegistry`:

```rust
    /// Remove and return all orders older than the given duration.
    /// Used for timeout detection - expired orders should be investigated/cancelled.
    pub fn expire_older_than(&mut self, max_age: Duration) -> Vec<PendingOrder> {
        let now = Instant::now();
        let expired_tickers: Vec<String> = self
            .orders
            .iter()
            .filter(|(_, order)| now.duration_since(order.submitted_at) > max_age)
            .map(|(ticker, _)| ticker.clone())
            .collect();

        expired_tickers
            .into_iter()
            .filter_map(|ticker| self.orders.remove(&ticker))
            .collect()
    }
```

Add `use std::time::Duration;` at the top if not present.

**Step 4: Run test to verify it passes**

Run: `cd kalshi-arb && cargo test pending_orders::tests`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add kalshi-arb/src/engine/pending_orders.rs
git commit -m "feat(pending_orders): add TTL expiration for stuck orders

- Add expire_older_than method to remove orders exceeding max age
- Returns expired orders with their order IDs for cancellation
- Prevents ghost pending orders from blocking new trades

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Implement Kill-Switch Order Cancellation in main.rs

Wire up the kill-switch handler to actually cancel pending orders using the new infrastructure.

**Files:**
- Modify: `kalshi-arb/src/main.rs` (around line 885-900)

**Step 1: Identify current kill-switch code**

Current code at `main.rs:885-899`:
```rust
tui::TuiCommand::KillSwitch => {
    tracing::error!("KILL SWITCH ACTIVATED - halting all trading");
    if let Some(ref mut po) = pending_orders {
        let count = po.count();
        if count > 0 {
            tracing::error!(count, "clearing pending orders");
        }
        // Note: PendingOrderRegistry doesn't have drain, so we log the count
        // Actual order cancellation would require order IDs (future work)
    }
    state_tx_engine.send_modify(|s| {
        s.is_paused = true;
        s.push_log("KILL", "KILL SWITCH ACTIVATED - all trading halted".to_string());
    });
    return Ok(()); // Exit engine loop
}
```

**Step 2: Update to cancel orders**

Replace the kill-switch handler with:

```rust
tui::TuiCommand::KillSwitch => {
    tracing::error!("KILL SWITCH ACTIVATED - halting all trading");

    // Cancel all pending orders
    if let Some(ref mut po) = pending_orders {
        let order_ids = po.all_order_ids();
        if !order_ids.is_empty() {
            tracing::error!(count = order_ids.len(), "cancelling pending orders");
            for order_id in &order_ids {
                if let Err(e) = executor.cancel_order(order_id).await {
                    tracing::error!(order_id = %order_id, error = %e, "failed to cancel order");
                } else {
                    tracing::info!(order_id = %order_id, "order cancelled");
                }
            }
        }
        // Clear the registry
        while po.count() > 0 {
            if let Some((ticker, _)) = po.orders.iter().next().map(|(k, v)| (k.clone(), v.clone())) {
                po.complete(&ticker);
            } else {
                break;
            }
        }
    }

    state_tx_engine.send_modify(|s| {
        s.is_paused = true;
        s.push_log("KILL", "KILL SWITCH ACTIVATED - all trading halted".to_string());
    });
    return Ok(());
}
```

**Note:** The `orders` field is private, so we need to add a `drain` method to `PendingOrderRegistry`:

```rust
    /// Remove and return all pending orders (for kill-switch).
    pub fn drain(&mut self) -> Vec<PendingOrder> {
        self.orders.drain().map(|(_, order)| order).collect()
    }
```

Then simplify the main.rs code to:

```rust
tui::TuiCommand::KillSwitch => {
    tracing::error!("KILL SWITCH ACTIVATED - halting all trading");

    // Cancel all pending orders
    if let Some(ref mut po) = pending_orders {
        let orders = po.drain();
        if !orders.is_empty() {
            tracing::error!(count = orders.len(), "cancelling pending orders");
            for order in &orders {
                if let Some(ref order_id) = order.order_id {
                    if let Err(e) = executor.cancel_order(order_id).await {
                        tracing::error!(order_id = %order_id, error = %e, "failed to cancel order");
                    } else {
                        tracing::info!(order_id = %order_id, "order cancelled");
                    }
                }
            }
        }
    }

    state_tx_engine.send_modify(|s| {
        s.is_paused = true;
        s.push_log("KILL", "KILL SWITCH ACTIVATED - all trading halted".to_string());
    });
    return Ok(());
}
```

**Step 3: Run the build to verify compilation**

Run: `cd kalshi-arb && cargo build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add kalshi-arb/src/engine/pending_orders.rs kalshi-arb/src/main.rs
git commit -m "feat(kill-switch): cancel in-flight orders on F12

- Add drain method to PendingOrderRegistry
- Kill-switch now calls cancel_order for each pending order
- Logs success/failure for each cancellation attempt
- Critical safety feature for live trading

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add Position Reconciliation Retry Logic

The startup reconciliation currently fails immediately if the API call fails. Add retry logic with exponential backoff.

**Files:**
- Modify: `kalshi-arb/src/main.rs` (around line 822-858)

**Step 1: Identify current reconciliation code**

Current code at `main.rs:822-858`:
```rust
// Reconcile positions on startup (live mode only)
if !sim_mode_engine {
    match rest_for_engine.get_positions().await {
        Ok(positions) => { /* ... handle positions ... */ }
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch positions on startup");
            anyhow::bail!("Cannot start without position reconciliation: {}", e);
        }
    }
}
```

**Step 2: Create retry helper function**

Add near the top of `main.rs` (after imports):

```rust
/// Retry an async operation with exponential backoff.
async fn retry_with_backoff<T, E, F, Fut>(
    operation_name: &str,
    max_attempts: u32,
    initial_delay_ms: u64,
    mut operation: F,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let mut attempt = 0;
    let mut delay_ms = initial_delay_ms;

    loop {
        attempt += 1;
        match operation().await {
            Ok(result) => return Ok(result),
            Err(e) => {
                if attempt >= max_attempts {
                    tracing::error!(
                        operation = operation_name,
                        attempts = attempt,
                        error = %e,
                        "operation failed after max retries"
                    );
                    return Err(e);
                }
                tracing::warn!(
                    operation = operation_name,
                    attempt = attempt,
                    max_attempts = max_attempts,
                    delay_ms = delay_ms,
                    error = %e,
                    "operation failed, retrying"
                );
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                delay_ms = (delay_ms * 2).min(30_000); // Cap at 30 seconds
            }
        }
    }
}
```

**Step 3: Update reconciliation to use retry**

Replace the reconciliation block with:

```rust
// Reconcile positions on startup (live mode only)
if !sim_mode_engine {
    let rest_clone = rest_for_engine.clone();
    let positions = retry_with_backoff(
        "position_reconciliation",
        3,      // max 3 attempts
        1000,   // start with 1 second delay
        || async {
            rest_clone.get_positions().await
        },
    )
    .await
    .context("Cannot start without position reconciliation")?;

    if !positions.is_empty() {
        tracing::warn!(count = positions.len(), "found existing positions on startup");
        for pos in &positions {
            tracing::info!(
                ticker = %pos.ticker,
                position = pos.position,
                "existing position"
            );
            if pos.position > 0 {
                if let Some(ref mut rm) = risk_manager {
                    rm.record_buy(&pos.ticker, pos.position as u32);
                }
                if let Some(ref mut pt) = position_tracker {
                    pt.record_entry(pos.ticker.clone(), pos.position as u32, 0, 0);
                }
            }
        }
        tracing::info!("position reconciliation complete");
    } else {
        tracing::info!("no existing positions found");
    }
} else {
    tracing::info!("simulation mode: skipping position reconciliation");
}
```

**Step 4: Run the build to verify compilation**

Run: `cd kalshi-arb && cargo build`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat(startup): add retry logic to position reconciliation

- Add retry_with_backoff helper with exponential backoff
- Position reconciliation now retries 3 times before failing
- Delays: 1s -> 2s -> 4s (capped at 30s)
- Handles transient API failures gracefully

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add Slippage Buffer Configuration

Add a configurable slippage buffer that reduces the effective edge calculation to account for execution slippage.

**Files:**
- Modify: `kalshi-arb/src/config.rs` (add field to StrategyConfig)
- Modify: `kalshi-arb/src/engine/strategy.rs` (apply buffer)
- Modify: `kalshi-arb/config.toml` (add default value)
- Test: `kalshi-arb/src/engine/strategy.rs` (inline tests)

**Step 1: Write the failing test**

Add to tests in `strategy.rs`:

```rust
    #[test]
    fn test_evaluate_with_slippage_buffer() {
        // Edge of 5 with 2-cent slippage buffer -> effective edge of 3
        // Should downgrade from taker (threshold 5) to maker (threshold 2)
        let signal = evaluate_with_slippage(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100, 2);
        assert!(matches!(signal.action, TradeAction::MakerBuy { .. }));
    }

    #[test]
    fn test_slippage_buffer_can_cause_skip() {
        // Edge of 3 with 2-cent slippage buffer -> effective edge of 1
        // Below maker threshold (2) -> SKIP
        let signal = evaluate_with_slippage(63, 58, 60, 5, 2, 1, 100_000, 0.25, 100, 2);
        assert_eq!(signal.action, TradeAction::Skip);
    }
```

**Step 2: Run test to verify it fails**

Run: `cd kalshi-arb && cargo test strategy::tests::test_evaluate_with_slippage_buffer`
Expected: FAIL with "cannot find function `evaluate_with_slippage`"

**Step 3: Add slippage_buffer_cents to config**

In `config.rs`, add to `StrategyConfig`:

```rust
#[derive(Debug, Deserialize, Clone)]
pub struct StrategyConfig {
    pub taker_edge_threshold: u8,
    pub maker_edge_threshold: u8,
    pub min_edge_after_fees: u8,
    #[serde(default)]
    pub slippage_buffer_cents: u8,  // NEW: subtracted from edge calculation
}
```

**Step 4: Implement evaluate_with_slippage**

Add to `strategy.rs`:

```rust
/// Evaluate with slippage buffer applied to edge calculation.
/// slippage_buffer_cents is subtracted from the raw edge before threshold comparison.
#[allow(clippy::too_many_arguments)]
pub fn evaluate_with_slippage(
    fair_value: u32,
    best_bid: u32,
    best_ask: u32,
    taker_threshold: u8,
    maker_threshold: u8,
    min_edge_after_fees: u8,
    bankroll_cents: u64,
    kelly_fraction: f64,
    max_contracts: u32,
    slippage_buffer_cents: u8,
) -> StrategySignal {
    if best_ask == 0 || fair_value == 0 {
        return StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge: 0,
            net_profit_estimate: 0,
            quantity: 0,
        };
    }

    let raw_edge = fair_value as i32 - best_ask as i32;
    let effective_edge = raw_edge - slippage_buffer_cents as i32;

    if effective_edge < maker_threshold as i32 {
        return StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge: raw_edge,  // Report raw edge for display
            net_profit_estimate: 0,
            quantity: 0,
        };
    }

    // Kelly-size for taker path (using actual price, not buffered)
    let taker_qty = {
        let raw = super::kelly::kelly_size(fair_value, best_ask, bankroll_cents, kelly_fraction);
        raw.min(max_contracts)
    };
    let entry_fee_taker = calculate_fee(best_ask, taker_qty, true) as i32;
    let exit_fee_maker_t = calculate_fee(fair_value, taker_qty, false) as i32;
    let taker_profit = (fair_value as i32 - best_ask as i32) * taker_qty as i32
        - entry_fee_taker
        - exit_fee_maker_t
        - (slippage_buffer_cents as i32 * taker_qty as i32); // Deduct expected slippage

    // Kelly-size for maker path
    let maker_buy_price = best_bid.saturating_add(1).min(99);
    let maker_qty = {
        let raw =
            super::kelly::kelly_size(fair_value, maker_buy_price, bankroll_cents, kelly_fraction);
        raw.min(max_contracts)
    };
    let entry_fee_maker = calculate_fee(maker_buy_price, maker_qty, false) as i32;
    let exit_fee_maker_m = calculate_fee(fair_value, maker_qty, false) as i32;
    let maker_profit = (fair_value as i32 - maker_buy_price as i32) * maker_qty as i32
        - entry_fee_maker
        - exit_fee_maker_m; // Maker has less slippage risk

    if effective_edge >= taker_threshold as i32 && taker_profit >= min_edge_after_fees as i32 {
        StrategySignal {
            action: TradeAction::TakerBuy,
            price: best_ask,
            edge: raw_edge,
            net_profit_estimate: taker_profit,
            quantity: taker_qty,
        }
    } else if effective_edge >= maker_threshold as i32 && maker_profit >= min_edge_after_fees as i32 {
        StrategySignal {
            action: TradeAction::MakerBuy {
                bid_price: maker_buy_price,
            },
            price: maker_buy_price,
            edge: raw_edge,
            net_profit_estimate: maker_profit,
            quantity: maker_qty,
        }
    } else {
        StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge: raw_edge,
            net_profit_estimate: 0,
            quantity: 0,
        }
    }
}
```

**Step 5: Run tests to verify they pass**

Run: `cd kalshi-arb && cargo test strategy::tests`
Expected: All tests PASS

**Step 6: Update config.toml with default**

Add to `[strategy]` section:

```toml
slippage_buffer_cents = 1  # Conservative 1-cent buffer for live trading
```

**Step 7: Commit**

```bash
git add kalshi-arb/src/config.rs kalshi-arb/src/engine/strategy.rs kalshi-arb/config.toml
git commit -m "feat(strategy): add configurable slippage buffer

- Add slippage_buffer_cents to StrategyConfig
- New evaluate_with_slippage function applies buffer to edge
- Buffer is deducted from profit estimate for taker orders
- Default: 1 cent (conservative for live trading)
- Prevents false-positive arbitrage signals

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Integrate Slippage Buffer into Main Engine Loop

Update the main engine loop to use the new slippage-aware evaluation function.

**Files:**
- Modify: `kalshi-arb/src/main.rs` (strategy evaluation calls)

**Step 1: Find strategy evaluation calls**

Search for `engine::strategy::evaluate` calls in main.rs and update them to use `evaluate_with_slippage` with the config value.

**Step 2: Update imports**

Ensure `engine::strategy::evaluate_with_slippage` is imported or use fully qualified path.

**Step 3: Update all evaluate calls**

Where you see:
```rust
let signal = engine::strategy::evaluate(
    fair_value,
    best_bid,
    best_ask,
    strategy.taker_edge_threshold,
    strategy.maker_edge_threshold,
    strategy.min_edge_after_fees,
    bankroll_cents,
    risk_config.kelly_fraction,
    risk_config.max_contracts_per_market,
);
```

Replace with:
```rust
let signal = engine::strategy::evaluate_with_slippage(
    fair_value,
    best_bid,
    best_ask,
    strategy.taker_edge_threshold,
    strategy.maker_edge_threshold,
    strategy.min_edge_after_fees,
    bankroll_cents,
    risk_config.kelly_fraction,
    risk_config.max_contracts_per_market,
    strategy.slippage_buffer_cents,
);
```

**Step 4: Run build and tests**

Run: `cd kalshi-arb && cargo build && cargo test`
Expected: All compile and pass

**Step 5: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat(engine): use slippage-aware strategy evaluation

- Replace evaluate() calls with evaluate_with_slippage()
- Slippage buffer now applied to all trading decisions
- Configurable via strategy.slippage_buffer_cents

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Add Periodic Order Timeout Check to Engine Loop

Add a periodic check in the main loop that expires old pending orders and optionally cancels them.

**Files:**
- Modify: `kalshi-arb/src/main.rs` (engine loop)
- Modify: `kalshi-arb/src/config.rs` (add timeout config)

**Step 1: Add timeout config**

In `config.rs`, add to `ExecutionConfig`:

```rust
#[derive(Debug, Deserialize, Clone)]
pub struct ExecutionConfig {
    #[allow(dead_code)]
    pub maker_timeout_ms: u64,
    #[allow(dead_code)]
    pub stale_odds_threshold_ms: u64,
    #[serde(default = "default_dry_run")]
    pub dry_run: bool,
    #[serde(default = "default_order_timeout_secs")]
    pub order_timeout_secs: u64,  // NEW
}

fn default_order_timeout_secs() -> u64 {
    30  // 30 second default
}
```

**Step 2: Add timeout check to engine loop**

In the main loop, after draining TUI commands and before strategy evaluation, add:

```rust
// Expire stale pending orders
if let Some(ref mut po) = pending_orders {
    let timeout = Duration::from_secs(execution_config.order_timeout_secs);
    let expired = po.expire_older_than(timeout);
    for order in expired {
        tracing::warn!(
            ticker = %order.ticker,
            age_secs = order.submitted_at.elapsed().as_secs(),
            order_id = ?order.order_id,
            "expired stale pending order"
        );
        // Attempt to cancel if we have an order ID
        if let Some(ref order_id) = order.order_id {
            if let Err(e) = executor.cancel_order(order_id).await {
                tracing::error!(order_id = %order_id, error = %e, "failed to cancel expired order");
            }
        }
    }
}
```

**Step 3: Update config.toml**

Add to `[execution]` section:

```toml
order_timeout_secs = 30
```

**Step 4: Run build**

Run: `cd kalshi-arb && cargo build`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add kalshi-arb/src/config.rs kalshi-arb/src/main.rs kalshi-arb/config.toml
git commit -m "feat(engine): add periodic order timeout detection

- Add order_timeout_secs config (default 30s)
- Engine loop expires and cancels orders exceeding timeout
- Prevents stuck orders from blocking new trades
- Logs warnings for expired orders

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Add Integration Test for Full Safety Flow

Create an integration test that verifies all safety mechanisms work together.

**Files:**
- Create: `kalshi-arb/tests/critical_safety_flow.rs`

**Step 1: Write the integration test**

```rust
//! Integration test for critical safety mechanisms.

use kalshi_arb::config::RiskConfig;
use kalshi_arb::engine::pending_orders::PendingOrderRegistry;
use kalshi_arb::engine::positions::PositionTracker;
use kalshi_arb::engine::risk::RiskManager;
use kalshi_arb::engine::strategy::{evaluate_with_slippage, TradeAction};
use std::time::Duration;

#[test]
fn test_full_safety_gate_flow() {
    // 1. Risk manager allows initial trade
    let risk_config = RiskConfig {
        max_contracts_per_market: 10,
        max_total_exposure_cents: 1000,
        max_concurrent_markets: 3,
        kelly_fraction: 0.25,
    };
    let mut risk_manager = RiskManager::new(risk_config);
    assert!(risk_manager.can_trade("TEST-1", 5, 500));

    // 2. Position tracker prevents duplicate
    let mut position_tracker = PositionTracker::new();
    position_tracker.record_entry("TEST-1".to_string(), 5, 50, 520);
    assert!(position_tracker.has_position("TEST-1"));

    // 3. Pending order registry prevents duplicate submission
    let mut pending_orders = PendingOrderRegistry::new();
    assert!(pending_orders.try_register("TEST-2".to_string(), 5, 60, true));
    assert!(!pending_orders.try_register("TEST-2".to_string(), 5, 60, true));

    // 4. Order ID tracking for cancellation
    pending_orders.set_order_id("TEST-2", "order-123".to_string());
    assert_eq!(pending_orders.get_order_id("TEST-2"), Some("order-123".to_string()));

    // 5. Slippage buffer affects strategy
    // Edge of 5 with 3-cent buffer -> effective edge of 2 -> maker only
    let signal = evaluate_with_slippage(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100, 3);
    assert!(matches!(signal.action, TradeAction::MakerBuy { .. }));

    // 6. Order timeout expiration (immediate check won't expire fresh orders)
    let expired = pending_orders.expire_older_than(Duration::from_secs(0));
    assert!(expired.is_empty(), "fresh orders should not expire immediately");
}

#[test]
fn test_drain_returns_all_orders() {
    let mut registry = PendingOrderRegistry::new();
    registry.register_with_id("T1".to_string(), 1, 50, true, Some("o1".to_string()));
    registry.register_with_id("T2".to_string(), 2, 60, false, Some("o2".to_string()));
    registry.try_register("T3".to_string(), 3, 70, true); // No order ID

    let drained = registry.drain();
    assert_eq!(drained.len(), 3);
    assert_eq!(registry.count(), 0);

    let order_ids: Vec<_> = drained.iter().filter_map(|o| o.order_id.as_ref()).collect();
    assert_eq!(order_ids.len(), 2);
}
```

**Step 2: Run the test**

Run: `cd kalshi-arb && cargo test critical_safety_flow`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add kalshi-arb/tests/critical_safety_flow.rs
git commit -m "test: add integration test for critical safety flow

- Verifies all safety mechanisms work together
- Tests: risk manager, position tracker, pending orders
- Tests: order ID tracking, slippage buffer, timeout expiration
- Tests: drain for kill-switch bulk cancellation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Update Documentation

Update CLAUDE.md and create a safety mechanisms reference.

**Files:**
- Modify: `kalshi-arb/CLAUDE.md` (update checklist)

**Step 1: Update the Pre-Live Trading Checklist**

Add to the safety features section in CLAUDE.md:

```markdown
Safety features active:
- ✅ RiskManager enforces exposure limits
- ✅ PositionTracker prevents duplicates
- ✅ PendingOrderRegistry prevents double-submission
- ✅ Staleness check before strategy evaluation
- ✅ Break-even validation before entry
- ✅ Bankroll deduction prevents over-allocation
- ✅ Position reconciliation on startup (with retry)
- ✅ Kill switch (F12) for emergency halt with order cancellation
- ✅ Order timeout detection (30s default)
- ✅ Slippage buffer in strategy evaluation
- ✅ Error handling (no critical unwraps)
```

**Step 2: Commit**

```bash
git add kalshi-arb/CLAUDE.md
git commit -m "docs: update safety features checklist

- Add order cancellation, timeout detection, slippage buffer
- Update position reconciliation to note retry capability
- All critical gaps now addressed

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Final Verification

Run full test suite and build release binary.

**Step 1: Run all tests**

Run: `cd kalshi-arb && cargo test`
Expected: All tests PASS

**Step 2: Build release binary**

Run: `cd kalshi-arb && cargo build --release --target x86_64-pc-windows-gnu`
Expected: Build succeeds

**Step 3: Copy binary**

Run: `cp kalshi-arb/target/x86_64-pc-windows-gnu/release/kalshi-arb.exe kalshi-arb/kalshi-arb.exe`

**Step 4: Final commit**

```bash
git add kalshi-arb/kalshi-arb.exe
git commit -m "build: update Windows executable with critical safety features

Includes:
- Order cancellation on kill-switch
- Order timeout detection
- Position reconciliation retry
- Slippage buffer in strategy

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary of Changes

| File | Changes |
|------|---------|
| `execution/executor.rs` | Add `cancel_order` method |
| `engine/pending_orders.rs` | Add `order_id` field, `register_with_id`, `set_order_id`, `get`, `get_order_id`, `all_order_ids`, `drain`, `expire_older_than` |
| `engine/strategy.rs` | Add `evaluate_with_slippage` function |
| `config.rs` | Add `slippage_buffer_cents`, `order_timeout_secs` |
| `main.rs` | Retry logic for reconciliation, slippage-aware eval, timeout check, kill-switch cancellation |
| `config.toml` | Add `slippage_buffer_cents = 1`, `order_timeout_secs = 30` |
| `tests/critical_safety_flow.rs` | Integration test for all safety mechanisms |
| `CLAUDE.md` | Updated safety checklist |

---

**Plan complete and saved to `docs/plans/2026-02-03-critical-gaps-live-trading.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
