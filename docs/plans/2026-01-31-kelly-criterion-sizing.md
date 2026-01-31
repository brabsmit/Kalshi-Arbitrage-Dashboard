# Kelly Criterion Position Sizing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Kelly criterion-based position sizing so contract quantity scales with edge magnitude and bankroll.

**Architecture:** New pure `kelly_size()` function in `src/engine/kelly.rs`. Called from `strategy::evaluate()` after action selection. Quantity capped by existing risk limits. Bankroll sourced from already-polled live Kalshi balance. Configurable fractional Kelly via `config.toml`.

**Tech Stack:** Rust, no new dependencies.

---

### Task 1: Kelly sizing module — tests

**Files:**
- Create: `kalshi-arb/src/engine/kelly.rs`

**Step 1: Write failing tests for `kelly_size`**

Create `kalshi-arb/src/engine/kelly.rs` with tests only (no implementation):

```rust
/// Kelly criterion position sizing for Kalshi binary options.

/// Compute Kelly-optimal contract quantity.
///
/// - `fair_value`: vig-free probability in cents (1–99)
/// - `entry_price`: price per contract in cents (1–99)
/// - `bankroll_cents`: available balance in cents
/// - `kelly_fraction`: scaling factor (e.g. 0.25 for quarter-Kelly)
///
/// Returns recommended quantity, minimum 1.
pub fn kelly_size(
    _fair_value: u32,
    _entry_price: u32,
    _bankroll_cents: u64,
    _kelly_fraction: f64,
) -> u32 {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strong_edge_large_bankroll() {
        // fair=70, entry=60 → p=0.70, b=(100-60)/60=0.667
        // f* = (0.667*0.70 - 0.30) / 0.667 = (0.467 - 0.30) / 0.667 = 0.2505
        // wager = 0.2505 * 0.25 * 100_000 = 6262 cents
        // qty = floor(6262 / 60) = 104
        let qty = kelly_size(70, 60, 100_000, 0.25);
        assert_eq!(qty, 104);
    }

    #[test]
    fn test_small_edge_returns_floor_of_1() {
        // fair=61, entry=60 → p=0.61, b=0.667
        // f* = (0.667*0.61 - 0.39) / 0.667 = (0.407 - 0.39) / 0.667 = 0.0255
        // wager = 0.0255 * 0.25 * 10_000 = 63.7 cents
        // qty = floor(63.7 / 60) = 1 (floor is 1, matches min)
        let qty = kelly_size(61, 60, 10_000, 0.25);
        assert_eq!(qty, 1);
    }

    #[test]
    fn test_negative_kelly_returns_floor_of_1() {
        // fair=55, entry=60 → p=0.55, b=0.667
        // f* = (0.667*0.55 - 0.45) / 0.667 = (0.367 - 0.45) / 0.667 = -0.1245 (negative)
        // Strategy thresholds already filtered, so return floor of 1.
        let qty = kelly_size(55, 60, 100_000, 0.25);
        assert_eq!(qty, 1);
    }

    #[test]
    fn test_half_kelly_doubles_quarter() {
        // Same setup as strong_edge but kelly_fraction=0.50
        // wager = 0.2505 * 0.50 * 100_000 = 12525 cents
        // qty = floor(12525 / 60) = 208
        let qty = kelly_size(70, 60, 100_000, 0.50);
        assert_eq!(qty, 208);
    }

    #[test]
    fn test_zero_bankroll_returns_1() {
        let qty = kelly_size(70, 60, 0, 0.25);
        assert_eq!(qty, 1);
    }

    #[test]
    fn test_boundary_prices() {
        // entry_price=1 (extreme underdog), fair=5
        // b = 99/1 = 99, p=0.05, q=0.95
        // f* = (99*0.05 - 0.95) / 99 = (4.95 - 0.95) / 99 = 0.04040
        // wager = 0.04040 * 0.25 * 50_000 = 505 cents
        // qty = floor(505 / 1) = 505
        let qty = kelly_size(5, 1, 50_000, 0.25);
        assert_eq!(qty, 505);
    }

    #[test]
    fn test_entry_price_99() {
        // entry_price=99 (heavy favorite), fair=99
        // b = 1/99 = 0.0101, p=0.99, q=0.01
        // f* = (0.0101*0.99 - 0.01) / 0.0101 = (0.01 - 0.01) / 0.0101 ≈ 0
        // Edge is zero → floor of 1
        let qty = kelly_size(99, 99, 100_000, 0.25);
        assert_eq!(qty, 1);
    }

    #[test]
    fn test_kelly_fraction_zero_returns_1() {
        // kelly_fraction=0 means don't use Kelly → always 1
        let qty = kelly_size(70, 60, 100_000, 0.0);
        assert_eq!(qty, 1);
    }
}
```

**Step 2: Register the module**

In `kalshi-arb/src/engine/mod.rs`, add `pub mod kelly;` after the existing modules.

**Step 3: Run tests to verify they fail**

Run: `cargo test -p kalshi-arb kelly -- --nocapture`
Expected: All 8 tests FAIL with `not yet implemented`

---

### Task 2: Kelly sizing module — implementation

**Files:**
- Modify: `kalshi-arb/src/engine/kelly.rs` (replace `todo!()`)

**Step 1: Implement `kelly_size`**

Replace the `todo!()` body with:

```rust
pub fn kelly_size(
    fair_value: u32,
    entry_price: u32,
    bankroll_cents: u64,
    kelly_fraction: f64,
) -> u32 {
    if entry_price == 0 || entry_price >= 100 || fair_value == 0 || bankroll_cents == 0 || kelly_fraction <= 0.0 {
        return 1;
    }

    let p = fair_value as f64 / 100.0;
    let q = 1.0 - p;
    let b = (100.0 - entry_price as f64) / entry_price as f64;

    // f* = (b*p - q) / b
    let f_star = (b * p - q) / b;

    if f_star <= 0.0 {
        return 1;
    }

    let wager_cents = f_star * kelly_fraction * bankroll_cents as f64;
    let qty = (wager_cents / entry_price as f64).floor() as u32;

    qty.max(1)
}
```

**Step 2: Run tests to verify they pass**

Run: `cargo test -p kalshi-arb kelly -- --nocapture`
Expected: All 8 tests PASS

**Step 3: Commit**

```bash
git add kalshi-arb/src/engine/kelly.rs kalshi-arb/src/engine/mod.rs
git commit -m "feat(kelly): add Kelly criterion position sizing module with tests"
```

---

### Task 3: Config — add `kelly_fraction`

**Files:**
- Modify: `kalshi-arb/src/config.rs:31-36` (`RiskConfig` struct)
- Modify: `kalshi-arb/config.toml:42-45` (`[risk]` section)

**Step 1: Add field to `RiskConfig`**

In `kalshi-arb/src/config.rs`, add `kelly_fraction` to `RiskConfig`:

```rust
#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct RiskConfig {
    pub max_contracts_per_market: u32,
    pub max_total_exposure_cents: u64,
    pub max_concurrent_markets: u32,
    pub kelly_fraction: f64,
}
```

**Step 2: Add value to `config.toml`**

In `kalshi-arb/config.toml`, under `[risk]`, add:

```toml
kelly_fraction = 0.25
```

**Step 3: Run existing tests to verify nothing broke**

Run: `cargo test -p kalshi-arb`
Expected: All tests PASS (config parse test will validate the new field)

**Step 4: Commit**

```bash
git add kalshi-arb/src/config.rs kalshi-arb/config.toml
git commit -m "feat(config): add kelly_fraction to risk config"
```

---

### Task 4: Strategy — add `quantity` to `StrategySignal` and wire Kelly into `evaluate()`

**Files:**
- Modify: `kalshi-arb/src/engine/strategy.rs`

**Step 1: Add `quantity` field to `StrategySignal`**

Change the struct at line 6:

```rust
pub struct StrategySignal {
    pub action: TradeAction,
    pub price: u32,
    pub edge: i32,
    pub net_profit_estimate: i32,
    pub quantity: u32,
}
```

**Step 2: Update `evaluate()` signature and body**

Add three new parameters and use Kelly sizing. The new signature:

```rust
pub fn evaluate(
    fair_value: u32,
    best_bid: u32,
    best_ask: u32,
    taker_threshold: u8,
    maker_threshold: u8,
    min_edge_after_fees: u8,
    bankroll_cents: u64,
    kelly_fraction: f64,
    max_contracts: u32,
) -> StrategySignal {
```

Update early-return Skip signals to include `quantity: 0`.

For the taker and maker branches, after determining the action is not Skip:
1. Call `kelly_size(fair_value, entry_price, bankroll_cents, kelly_fraction)`
2. Cap with `.min(max_contracts)`
3. Recalculate fees using the actual quantity
4. Recalculate `net_profit_estimate` as `(fair_value - entry_price) * qty - entry_fee - exit_fee`

Full replacement for the body after the early returns (from the taker fee calc onward):

```rust
    // Kelly-size for taker path
    let taker_qty = {
        let raw = super::kelly::kelly_size(fair_value, best_ask, bankroll_cents, kelly_fraction);
        raw.min(max_contracts)
    };
    let entry_fee_taker = calculate_fee(best_ask, taker_qty, true) as i32;
    let exit_fee_maker_t = calculate_fee(fair_value, taker_qty, false) as i32;
    let taker_profit = (fair_value as i32 - best_ask as i32) * taker_qty as i32
        - entry_fee_taker - exit_fee_maker_t;

    // Kelly-size for maker path
    let maker_buy_price = best_bid.saturating_add(1).min(99);
    let maker_qty = {
        let raw = super::kelly::kelly_size(fair_value, maker_buy_price, bankroll_cents, kelly_fraction);
        raw.min(max_contracts)
    };
    let entry_fee_maker = calculate_fee(maker_buy_price, maker_qty, false) as i32;
    let exit_fee_maker_m = calculate_fee(fair_value, maker_qty, false) as i32;
    let maker_profit = (fair_value as i32 - maker_buy_price as i32) * maker_qty as i32
        - entry_fee_maker - exit_fee_maker_m;

    if edge >= taker_threshold as i32 && taker_profit >= min_edge_after_fees as i32 {
        StrategySignal {
            action: TradeAction::TakerBuy,
            price: best_ask,
            edge,
            net_profit_estimate: taker_profit,
            quantity: taker_qty,
        }
    } else if edge >= maker_threshold as i32 && maker_profit >= min_edge_after_fees as i32 {
        StrategySignal {
            action: TradeAction::MakerBuy { bid_price: maker_buy_price },
            price: maker_buy_price,
            edge,
            net_profit_estimate: maker_profit,
            quantity: maker_qty,
        }
    } else {
        StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge,
            net_profit_estimate: 0,
            quantity: 0,
        }
    }
```

**Step 3: Update `momentum_gate` Skip construction to include `quantity: 0`**

At line 106 (taker downgraded to skip):
```rust
StrategySignal {
    action: TradeAction::Skip,
    quantity: 0,
    ..signal
}
```

At line 124 (maker downgraded to skip):
```rust
StrategySignal {
    action: TradeAction::Skip,
    quantity: 0,
    ..signal
}
```

The `..signal` spread will carry over the quantity for non-skip downgrades (taker→maker), which is correct since the price changes but Kelly sizing is similar.

**Step 4: Update all tests**

Every call to `evaluate()` needs three new args: `bankroll_cents`, `kelly_fraction`, `max_contracts`. Use `100_000, 0.25, 100` as standard test values (100k cents = $1000 bankroll, quarter-kelly, high max so it doesn't interfere).

Replace every test call like:
```rust
evaluate(65, 58, 60, 5, 2, 1)
```
with:
```rust
evaluate(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100)
```

Tests that check `signal.action` and `signal.edge` remain valid. The `test_evaluate_taker_buy` test should also assert `signal.quantity > 0`.

**Step 5: Run tests**

Run: `cargo test -p kalshi-arb`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add kalshi-arb/src/engine/strategy.rs
git commit -m "feat(strategy): integrate Kelly sizing into evaluate() and StrategySignal"
```

---

### Task 5: Wire Kelly into `main.rs`

**Files:**
- Modify: `kalshi-arb/src/main.rs`

**Step 1: Pass Kelly params to `evaluate_matched_market`**

Add two new parameters to `evaluate_matched_market()` function signature (around line 304):
- `risk_config: &config::RiskConfig`
- `bankroll_cents: u64`

These replace needing to thread through individual fields.

**Step 2: Update the `strategy::evaluate()` call inside `evaluate_matched_market`**

At line 363, change:
```rust
let mut signal = strategy::evaluate(
    fair, bid, ask,
    strategy_config.taker_edge_threshold,
    strategy_config.maker_edge_threshold,
    strategy_config.min_edge_after_fees,
);
```
to:
```rust
let mut signal = strategy::evaluate(
    fair, bid, ask,
    strategy_config.taker_edge_threshold,
    strategy_config.maker_edge_threshold,
    strategy_config.min_edge_after_fees,
    bankroll_cents,
    risk_config.kelly_fraction,
    risk_config.max_contracts_per_market,
);
```

**Step 3: Update the stale-signal skip construction**

At line 386, add `quantity: 0`:
```rust
signal = strategy::StrategySignal {
    action: strategy::TradeAction::Skip,
    price: 0,
    edge: signal.edge,
    net_profit_estimate: 0,
    quantity: 0,
};
```

**Step 4: Update simulation fill to use Kelly quantity**

At line 435, replace the hardcoded sizing:
```rust
let qty = (5000u32 / fill_price).max(1);
```
with:
```rust
let qty = signal.quantity;
```

**Step 5: Update all call sites of `evaluate_matched_market`**

Search for all calls to `evaluate_matched_market` in `main.rs`. Each call needs the two new args: `&risk_config` (or the cloned config reference) and `bankroll_cents`.

For bankroll in sim mode, read `sim_balance_cents` from the state watcher. For live mode, read `balance_cents`. You can get this via `state_rx.borrow().balance_cents` (or `sim_balance_cents`).

Add before each call:
```rust
let bankroll = {
    let s = state_rx.borrow();
    if sim_mode { s.sim_balance_cents.max(0) as u64 } else { s.balance_cents.max(0) as u64 }
};
```

Then pass `&config.risk, bankroll` to each `evaluate_matched_market()` call.

**Step 6: Build and verify**

Run: `cargo build -p kalshi-arb`
Expected: Compiles with no errors.

Run: `cargo test -p kalshi-arb`
Expected: All tests PASS.

**Step 7: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat(main): wire Kelly sizing into evaluation pipeline and sim fills"
```

---

### Task 6: Verify end-to-end

**Step 1: Run full test suite**

Run: `cargo test -p kalshi-arb`
Expected: All tests PASS.

**Step 2: Run clippy**

Run: `cargo clippy -p kalshi-arb -- -D warnings`
Expected: No warnings.

**Step 3: Spot check — dry run with logs**

Run: `cargo run -p kalshi-arb 2>&1 | head -50`
Verify: Startup succeeds, balance is fetched, no panics. Ctrl-C to exit.

**Step 4: Final commit if any fixups needed**

Only if clippy or the dry run revealed issues.
