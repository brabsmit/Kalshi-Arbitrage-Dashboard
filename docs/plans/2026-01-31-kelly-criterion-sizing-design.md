# Kelly Criterion Position Sizing

## Problem

All trades use a hardcoded quantity of 1 contract regardless of edge magnitude or bankroll size. A 1-cent edge and a 50-cent edge trigger identical positions.

## Solution

Add Kelly criterion-based position sizing that scales contract quantity proportional to edge and bankroll.

## Kelly Formula (Binary Options)

For a Kalshi contract bought at price `c` cents:

- `p = fair_value / 100` (true win probability)
- `q = 1 - p`
- `b = (100 - c) / c` (net odds ratio; win pays 100c, cost is c)
- `f* = (b * p - q) / b` (Kelly fraction of bankroll to wager)
- `wager = f* * kelly_fraction * bankroll_cents`
- `quantity = floor(wager / entry_price), min 1`

## Design Decisions

- **Configurable Kelly fraction**: `kelly_fraction` in `config.toml` under `[risk]` (default 0.25)
- **Live Kalshi balance as bankroll**: Uses already-polled `get_balance()` value, no new API calls
- **Capped by existing risk limits**: `min(kelly_qty, max_contracts_per_market)` plus existing exposure checks in `can_trade()`
- **Both taker and maker orders**: Kelly sizing applies to both paths with their respective entry prices
- **Floor of 1 contract**: If strategy thresholds say trade, always trade at least 1 contract even if Kelly rounds to 0

## Changes

### New file: `src/engine/kelly.rs`

Pure function:

```rust
pub fn kelly_size(
    fair_value: u32,
    entry_price: u32,
    bankroll_cents: u64,
    kelly_fraction: f64,
) -> u32
```

### Modified files

1. **`src/engine/mod.rs`** - add `pub mod kelly;`
2. **`config.toml`** - add `kelly_fraction = 0.25` under `[risk]`
3. **`src/config.rs`** - add `kelly_fraction: f64` to `RiskConfig`
4. **`src/engine/strategy.rs`**:
   - Add `quantity: u32` to `StrategySignal`
   - Add `bankroll_cents`, `kelly_fraction`, `max_contracts` params to `evaluate()`
   - Call `kelly_size()` after determining action, cap with max_contracts
   - Use actual quantity in `calculate_fee()` and `net_profit_estimate`
   - Update tests
5. **`src/main.rs`** - pass balance and kelly_fraction to `evaluate()`; pass signal quantity to `can_trade()` and `record_buy()`

### Unchanged

- `src/engine/risk.rs` - already accepts `quantity` param
- `src/engine/fees.rs` - already accepts `quantity` param
