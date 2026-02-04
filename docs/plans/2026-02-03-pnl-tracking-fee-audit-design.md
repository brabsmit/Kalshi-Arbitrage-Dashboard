# P&L Tracking for Live Mode & Fee Audit

**Date:** 2026-02-03
**Status:** Approved

## Problem Statement

1. **Live mode doesn't record P&L** — trades are logged to the recent trades section but the `pnl` field is `None` or 0, and the global `realized_pnl_cents` counter isn't updated when positions close.

2. **Fee validation uncertainty** — need to verify that no trades can slip through that appear profitable before fees but result in a loss after fees.

## Design

### 1. Unified P&L Tracking

**Current state:**
- `sim_realized_pnl_cents: i64` — used only in simulation
- `realized_pnl_cents: i64` — exists but unused in live mode
- `sim_winning_trades` / `sim_total_trades` — simulation only

**Changes:**

1. Remove the `sim_` prefix — rename to unified fields:
   - `realized_pnl_cents` (keep existing)
   - `total_trades: u32`
   - `winning_trades: u32`

2. Delete `sim_realized_pnl_cents` and related sim-specific fields

3. Update all references in `main.rs` to use the unified fields regardless of mode

4. Live exit P&L calculation — when a live position closes:
   ```
   pnl = (exit_price × quantity - exit_fee) - entry_cost_cents
   ```
   Where `entry_cost_cents` already includes the entry fee (stored in Position)

### 2. Live Exit Detection & P&L Recording

**Where live exits occur (needs P&L wiring):**

1. **Maker exit fills** — when sell order fills at target price
2. **Taker exit fills** — when market exit executes (break-even or timeout)
3. **Settlement** — when market settles (position resolves to 0 or 100)

**Implementation:**

Create a helper function:
```rust
fn record_exit_pnl(
    state: &mut AppState,
    ticker: &str,
    exit_price: u32,
    quantity: u32,
    entry_cost_cents: u32,
    is_taker_exit: bool,
) -> i32 {
    let exit_fee = calculate_fee(exit_price, quantity, is_taker_exit);
    let gross_revenue = exit_price * quantity;
    let pnl = (gross_revenue - exit_fee) as i32 - entry_cost_cents as i32;

    state.realized_pnl_cents += pnl as i64;
    state.total_trades += 1;
    if pnl > 0 { state.winning_trades += 1; }

    pnl  // Return for TradeRow
}
```

Call this function at each exit point, passing the returned `pnl` to `TradeRow` creation.

P&L is **realized only** — calculated when the position actually closes (exit order fills), not estimated on submission.

### 3. Comprehensive Fee Audit

**Kalshi's fee structure:**
- **Taker fee:** 7% of contract value, where value = price × (100 - price) / 100
- **Maker fee:** 1.75% of contract value (same formula)
- Fees are per contract, rounded up to nearest cent

**Current implementation** (`src/engine/fees.rs`):
```rust
// Taker: 7% × Q × P × (100-P) / 10,000
// Maker: 1.75% × Q × P × (100-P) / 1,000,000
```

**Audit points:**

1. **Formula correctness** — compare against Kalshi's published rates
2. **Rounding** — current code uses `div_ceil` (rounds up) — verify matches Kalshi
3. **Edge cases** — prices at 1, 99, 50 (max fee point)
4. **Strategy evaluation** — verify `min_edge_after_fees` check is applied correctly
5. **Break-even calculation** — verify it accounts for exit fees properly
6. **Entry gate** — ensure no trade enters if `expected_profit - total_fees < min_edge_after_fees`

**Files to audit:**
- `src/engine/fees.rs` — fee calculation
- `src/engine/strategy.rs` — signal generation with fee deduction
- `src/main.rs` — anywhere fees are calculated inline

## Implementation Plan

**Order of changes:**

1. **Fee audit first** — verify the math is correct before relying on it for P&L
   - Review Kalshi's current fee documentation
   - Test fee calculations against known examples
   - Fix any discrepancies found

2. **Unify state fields** — refactor `AppState`
   - Remove `sim_` prefixed fields
   - Use unified `realized_pnl_cents`, `total_trades`, `winning_trades`
   - Update all simulation code paths to use unified fields

3. **Wire live exit P&L** — add `record_exit_pnl` helper
   - Identify all live exit code paths in `main.rs`
   - Call helper at each exit point
   - Pass P&L value to `TradeRow` creation

4. **Test in dry-run mode** — verify P&L displays correctly before live

## Files to Modify

- `src/engine/fees.rs` — audit/fix if needed
- `src/engine/strategy.rs` — audit fee checks
- `src/tui/state.rs` — unify state fields
- `src/main.rs` — wire P&L recording at exit points

No new files needed — this is wiring existing infrastructure together.
