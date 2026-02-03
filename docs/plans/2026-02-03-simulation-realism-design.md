# Simulation Realism Design

**Goal:** Make simulated P&L closely match what live trading would produce.

**Problem:** Current simulation assumes instant fills at exact prices with infinite liquidity. Real markets have latency, queue position, slippage, and order rejections.

---

## Configuration

Extend `config.toml` with realism parameters:

```toml
[simulation]
latency_ms = 500
use_break_even_exit = true
validate_fair_value = false

[simulation.realism]
enabled = true

# Taker orders (taking liquidity at ask/bid)
taker_fill_rate = 0.85          # 85% of taker orders succeed
taker_slippage_mean_cents = 1   # Average 1c adverse slippage
taker_slippage_std_cents = 1    # Standard deviation

# Maker orders (posting limit orders)
maker_fill_rate = 0.45          # 45% of maker limit orders fill
maker_require_price_through = true  # Only fill if price moves THROUGH your level

# Latency
apply_latency = true            # Use latency_ms before checking fill

# Timeout
max_hold_seconds = 300          # Force exit after 5 min (0 = disabled)
timeout_exit_slippage_cents = 2 # Worse slippage on forced exits
```

Setting `enabled = false` reverts to instant-fill behavior.

---

## Entry Fill Logic

### Taker Entry

```
1. Signal fires (e.g., TakerBuy at ask=60c)
2. Wait latency_ms (500ms simulated delay)
3. Re-check orderbook: is ask still <= 60c?
   - NO → Order fails (opportunity gone), log as "missed"
   - YES → Continue
4. Roll fill probability (rand < taker_fill_rate?)
   - NO → Order fails (random rejection), log as "rejected"
   - YES → Continue
5. Apply slippage: actual_fill = ask + random_slippage(mean, std)
   - Clamp to [ask, ask+3] to avoid extreme outliers
6. Create SimPosition with actual_fill price
```

### Maker Entry

```
1. Signal fires (e.g., MakerBuy at bid+1 = 58c)
2. Wait latency_ms
3. Roll fill probability (rand < maker_fill_rate?)
   - NO → Order fails (queue position), log as "unfilled"
   - YES → Continue
4. No slippage for maker (you set the price)
5. Create SimPosition at intended price
```

---

## Exit Fill Logic

### Maker Exit (default - posting limit sell)

```
1. WebSocket shows yes_bid >= sell_price
2. If maker_require_price_through:
   - Only proceed if yes_bid > sell_price (strictly greater)
   - Rationale: bid equaling your price means you're competing
3. Roll fill probability (rand < maker_fill_rate?)
   - NO → Skip this tick, check again on next update
   - YES → Execute exit at sell_price
```

Failed exit attempts don't lose the opportunity - position remains, try again on next orderbook update.

### Taker Exit (timeout/panic)

```
1. Position held > max_hold_seconds?
2. Force taker exit at current best_bid
3. Apply timeout_exit_slippage_cents (adverse direction)
4. Log as "timeout_exit" with actual P&L
```

---

## Implementation Structure

### New file: `src/engine/fill_simulator.rs`

```rust
pub struct FillSimulator {
    config: SimulationRealismConfig,
    rng: StdRng,
}

impl FillSimulator {
    pub fn try_taker_entry(&mut self, signal_price: u32, current_ask: u32) -> FillResult;
    pub fn try_maker_entry(&mut self, signal_price: u32) -> FillResult;
    pub fn try_maker_exit(&mut self, sell_price: u32, current_bid: u32) -> FillResult;
    pub fn force_taker_exit(&mut self, current_bid: u32) -> FillResult;
}

pub enum FillResult {
    Filled { price: u32 },
    Missed,      // Opportunity gone after latency
    Rejected,    // Random rejection (queue, etc.)
    Pending,     // For exits: try again next tick
}
```

### Config changes: `src/config.rs`

Add `SimulationRealismConfig` struct nested under `SimulationConfig`.

### Entry changes: `src/pipeline.rs`

Before creating `SimPosition`:
- Call `fill_simulator.try_taker_entry()` or `try_maker_entry()`
- Handle `FillResult` variants
- Update miss/reject counters in `AppState`

### Exit changes: `src/main.rs` (WS handler)

- Replace instant fill with `fill_simulator.try_maker_exit()`
- On `Pending`, leave position unchanged
- Add timeout check for forced exits

### State changes: `src/tui/state.rs`

Add tracking fields:
- `sim_missed_entries: u32`
- `sim_rejected_entries: u32`
- `sim_timeout_exits: u32`
- `sim_total_entry_slippage_cents: i64`

---

## Validation Metrics

Track in TUI stats panel:

```
Entries Attempted:  47
  ├─ Filled:        31 (66%)
  ├─ Missed:         9 (19%)
  └─ Rejected:       7 (15%)

Exits Attempted:    31
  ├─ Filled:        28 (90%)
  ├─ Timeout:        3 (10%)
  └─ Pending:        0

Avg Entry Slippage: 0.8c
Avg Exit Slippage:  0.3c
```

### Tuning

Start with pessimistic values. Adjust based on observed market behavior. Calibrate against live results when available.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/config.rs` | Add `SimulationRealismConfig` struct |
| `config.toml` | Add `[simulation.realism]` section |
| `src/engine/mod.rs` | Export `fill_simulator` module |
| `src/engine/fill_simulator.rs` | New file - `FillSimulator` impl |
| `src/pipeline.rs` | Gate entries through `FillSimulator` |
| `src/main.rs` | Gate exits through `FillSimulator`, add timeout logic |
| `src/tui/state.rs` | Add realism tracking fields |
| `src/tui/widgets/stats.rs` | Display new metrics |
