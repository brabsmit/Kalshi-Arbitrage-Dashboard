# Simulation Mode Design

## Overview

Paper-trading simulation mode for the Kalshi arbitrage strategy. Instead of placing real orders, the app computes what it *would* buy, tracks virtual positions with resting sells at fair value, and monitors the live orderbook to determine if those sells would fill. Validates the strategy before risking real capital.

## Activation

CLI flag: `--simulate`. When passed, the app runs in simulation mode with a virtual $1000 balance. When not passed, behavior is identical to today.

## Simulated State

New fields on `AppState`:

- `sim_mode: bool` — true when `--simulate` is passed
- `sim_balance_cents: i64` — starts at 100,000 (i.e. $1000)
- `sim_positions: Vec<SimPosition>` — open virtual positions
- `sim_trades: VecDeque<TradeRow>` — completed sim trades
- `sim_realized_pnl_cents: i64` — cumulative realized P&L

New struct `SimPosition`:

```rust
pub struct SimPosition {
    pub ticker: String,
    pub quantity: u32,
    pub entry_price: u32,   // cents, the price we "bought" at
    pub sell_price: u32,    // cents, the fair value we're "resting" at
    pub entry_fee: u32,     // cents, taker fee paid on entry
    pub filled_at: Instant, // when we "bought"
}
```

## Simulated Buy Logic

When a strategy signal fires (TAKER or MAKER action):

1. Compute quantity: `qty = 5000 / entry_price` (integer division, minimum 1)
2. Compute entry cost: `qty * entry_price` cents
3. Compute entry fee: 7% taker fee via existing `calculate_fee`
4. Check `sim_balance_cents >= entry_cost + entry_fee` — skip if insufficient
5. Check no existing sim position for this ticker — skip if duplicate
6. Deduct `entry_cost + entry_fee` from `sim_balance_cents`
7. Create `SimPosition` with `sell_price = fair_value`
8. Record buy in `sim_trades`
9. Log: `"SIM BUY {qty}x {ticker} @ {entry_price}¢, sell target {fair_value}¢"`

Entry price: TAKER uses `best_ask`, MAKER uses `best_bid + 1`.

Position sizing: fixed $50 per trade.

## Simulated Sell (Fill Detection)

Every WebSocket orderbook update, for each open `SimPosition`:

1. Look up ticker in `live_book`
2. If `best_bid >= sim_position.sell_price` → filled
3. On fill:
   - Compute exit revenue: `qty * sell_price`
   - Compute exit fee: 1.75% maker fee via existing `calculate_fee`
   - Credit `exit_revenue - exit_fee` to `sim_balance_cents`
   - Compute P&L: `(exit_revenue - exit_fee) - (entry_cost + entry_fee)`
   - Add P&L to `sim_realized_pnl_cents`
   - Remove from `sim_positions`
   - Record sell in `sim_trades`
   - Log: `"SIM SELL {qty}x {ticker} @ {sell_price}¢, P&L: {pnl}¢"`

## TUI Changes

### Header (simulation mode only)

- Balance, Exposure, P&L numbers render in **blue** (`Color::Blue`)
- Balance shows `sim_balance_cents`
- Exposure shows sum of `entry_price * qty` across open sim positions
- P&L shows `sim_realized_pnl_cents`
- `[SIMULATION]` label displayed in blue

### Existing Panels

- Positions panel: populated from `sim_positions` (mapped to `PositionRow`)
- Trades panel: populated from `sim_trades`
- Markets table: unchanged
- Logs: SIM BUY/SIM SELL entries appear naturally

### When `--simulate` is NOT passed

Zero behavioral change. Sim fields exist on AppState but are unused.

## Files to Modify

1. **`main.rs`** — add `--simulate` clap arg, sim buy logic after signal evaluation, fill detection in WebSocket loop
2. **`tui/state.rs`** — add sim fields to AppState, add `SimPosition` struct
3. **`tui/render.rs`** — blue header in sim mode, source positions/trades from sim state

## Out of Scope

- No persistence across restarts
- No config file changes
- No new files or dependencies
- No changes to the real trading path
