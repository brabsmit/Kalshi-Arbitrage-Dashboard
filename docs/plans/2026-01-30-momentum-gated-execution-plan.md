# Momentum-Gated Execution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the momentum thresholds into the execution path so orders (both simulated and dry-run) are gated by composite momentum score, and add an action label reflecting the momentum gate.

**Architecture:** Add a `momentum_gate` function to `strategy.rs` that takes a `StrategySignal` and a momentum score + thresholds, returning a modified signal (potentially downgrading TAKER→MAKER or MAKER→SKIP based on momentum). Call this gate in `main.rs` immediately after `strategy::evaluate`, before logging or placing orders. Update the TUI action column to reflect the momentum-gated decision.

**Tech Stack:** Rust, tokio, ratatui (TUI)

---

### Task 1: Add `momentum_gate` function to strategy.rs

**Files:**
- Modify: `kalshi-arb/src/engine/strategy.rs:1-85`

**Step 1: Write the failing test**

Add tests to the existing `#[cfg(test)] mod tests` block in `strategy.rs`:

```rust
#[test]
fn test_momentum_gate_skip_below_maker_threshold() {
    // Edge qualifies for taker, but momentum is too low → SKIP
    let signal = evaluate(65, 58, 60, 5, 2, 1);
    assert_eq!(signal.action, TradeAction::TakerBuy);
    let gated = momentum_gate(signal, 30.0, 40, 75);
    assert_eq!(gated.action, TradeAction::Skip);
}

#[test]
fn test_momentum_gate_maker_in_middle_range() {
    // Edge qualifies for taker, momentum is moderate → MAKER
    let signal = evaluate(65, 58, 60, 5, 2, 1);
    assert_eq!(signal.action, TradeAction::TakerBuy);
    let gated = momentum_gate(signal, 55.0, 40, 75);
    assert!(matches!(gated.action, TradeAction::MakerBuy { .. }));
}

#[test]
fn test_momentum_gate_taker_above_threshold() {
    // Edge qualifies for taker, momentum is high → TAKER preserved
    let signal = evaluate(65, 58, 60, 5, 2, 1);
    assert_eq!(signal.action, TradeAction::TakerBuy);
    let gated = momentum_gate(signal, 80.0, 40, 75);
    assert_eq!(gated.action, TradeAction::TakerBuy);
}

#[test]
fn test_momentum_gate_skip_stays_skip() {
    // Edge too low → SKIP regardless of momentum
    let signal = evaluate(61, 58, 60, 5, 2, 1);
    assert_eq!(signal.action, TradeAction::Skip);
    let gated = momentum_gate(signal, 90.0, 40, 75);
    assert_eq!(gated.action, TradeAction::Skip);
}

#[test]
fn test_momentum_gate_maker_downgraded_to_skip() {
    // Edge qualifies for maker only, momentum too low → SKIP
    let signal = evaluate(63, 58, 60, 5, 2, 1);
    assert!(matches!(signal.action, TradeAction::MakerBuy { .. }));
    let gated = momentum_gate(signal, 20.0, 40, 75);
    assert_eq!(gated.action, TradeAction::Skip);
}

#[test]
fn test_momentum_gate_maker_preserved() {
    // Edge qualifies for maker, momentum moderate → MAKER preserved
    let signal = evaluate(63, 58, 60, 5, 2, 1);
    assert!(matches!(signal.action, TradeAction::MakerBuy { .. }));
    let gated = momentum_gate(signal, 50.0, 40, 75);
    assert!(matches!(gated.action, TradeAction::MakerBuy { .. }));
}
```

**Step 2: Run test to verify it fails**

Run: `cd kalshi-arb && cargo test --lib engine::strategy::tests -- --nocapture`
Expected: FAIL — `momentum_gate` not found

**Step 3: Write minimal implementation**

Add this function after the `evaluate` function in `strategy.rs` (before `american_to_probability`):

```rust
/// Apply momentum gating to a strategy signal.
///
/// Downgrades actions based on momentum score:
/// - Score < maker_threshold: force SKIP (edge without momentum)
/// - Score >= maker_threshold but < taker_threshold: cap at MAKER
/// - Score >= taker_threshold: allow TAKER
///
/// Signals already at SKIP pass through unchanged.
pub fn momentum_gate(
    signal: StrategySignal,
    momentum_score: f64,
    maker_momentum_threshold: u8,
    taker_momentum_threshold: u8,
) -> StrategySignal {
    match signal.action {
        TradeAction::Skip => signal,
        TradeAction::TakerBuy => {
            if momentum_score < maker_momentum_threshold as f64 {
                StrategySignal {
                    action: TradeAction::Skip,
                    ..signal
                }
            } else if momentum_score < taker_momentum_threshold as f64 {
                // Downgrade taker to maker
                let bid_price = signal.price.saturating_sub(1).max(1);
                StrategySignal {
                    action: TradeAction::MakerBuy { bid_price },
                    price: bid_price,
                    ..signal
                }
            } else {
                signal
            }
        }
        TradeAction::MakerBuy { .. } => {
            if momentum_score < maker_momentum_threshold as f64 {
                StrategySignal {
                    action: TradeAction::Skip,
                    ..signal
                }
            } else {
                signal
            }
        }
    }
}
```

**Step 4: Run test to verify it passes**

Run: `cd kalshi-arb && cargo test --lib engine::strategy::tests -- --nocapture`
Expected: PASS — all momentum_gate tests pass

**Step 5: Commit**

```bash
git add kalshi-arb/src/engine/strategy.rs
git commit -m "feat: add momentum_gate function to strategy module"
```

---

### Task 2: Wire momentum gate into main.rs engine loop

**Files:**
- Modify: `kalshi-arb/src/main.rs:392-426` (3-way signal block)
- Modify: `kalshi-arb/src/main.rs:511-545` (2-way signal block)

**Step 1: Update the 3-way signal block (lines ~392-426)**

After `let signal = strategy::evaluate(...)` and before `let action_str = match ...`, insert the momentum gate call. The `momentum_config` is already in scope.

Replace the block at lines 392-426 (inside the `for (side_opt, fair, label) in sides` loop) from:

```rust
let signal = strategy::evaluate(
    fair, bid, ask,
    strategy_config.taker_edge_threshold,
    strategy_config.maker_edge_threshold,
    strategy_config.min_edge_after_fees,
);

let action_str = match &signal.action {
```

With:

```rust
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
```

**Step 2: Update the 2-way signal block (lines ~511-545)**

Same change — after `let signal = strategy::evaluate(...)` insert the momentum gate.

Replace:

```rust
let signal = strategy::evaluate(
    fair, bid, ask,
    strategy_config.taker_edge_threshold,
    strategy_config.maker_edge_threshold,
    strategy_config.min_edge_after_fees,
);

let action_str = match &signal.action {
```

With:

```rust
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
```

**Step 3: Update dry-run log message to include momentum score**

In both signal log blocks (`tracing::warn!`), add `momentum = momentum` to the structured fields so logs show why a signal was gated or allowed.

For the 3-way block (around line 417-425), change:

```rust
tracing::warn!(
    ticker = %side.ticker,
    action = %action_str,
    side = label,
    price = signal.price,
    edge = signal.edge,
    net = signal.net_profit_estimate,
    "signal detected (dry run)"
);
```

To:

```rust
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
```

For the 2-way block (around line 535-544), change:

```rust
tracing::warn!(
    ticker = %mkt.ticker,
    action = %action_str,
    price = signal.price,
    edge = signal.edge,
    net = signal.net_profit_estimate,
    inverse = mkt.is_inverse,
    "signal detected (dry run)"
);
```

To:

```rust
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
```

**Step 4: Verify compilation**

Run: `cd kalshi-arb && cargo check`
Expected: PASS — no errors

**Step 5: Run all tests**

Run: `cd kalshi-arb && cargo test`
Expected: PASS — all tests pass (no main.rs integration tests exist, but unit tests must not regress)

**Step 6: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat: wire momentum gate into engine loop for both 2-way and 3-way markets"
```

---

### Task 3: Verify end-to-end with cargo clippy and test

**Files:**
- None (verification only)

**Step 1: Run clippy**

Run: `cd kalshi-arb && cargo clippy -- -W warnings`
Expected: No warnings related to momentum_gate or modified code

**Step 2: Run full test suite**

Run: `cd kalshi-arb && cargo test`
Expected: All tests pass

**Step 3: Commit any clippy fixes if needed**

```bash
git add -A && git commit -m "fix: address clippy warnings"
```
