# Max Edge Gating Design

## Problem

When calculated edge is unusually high (e.g., >15 cents), it often indicates something unusual:
- Stale quotes on one side
- A market about to close/settle
- Model error or data issue

Currently the strategy has minimum edge thresholds but no maximum cap. This feature adds a max edge gate to skip suspicious opportunities.

## Design

### Configuration

Add `max_edge_threshold` to the global `[strategy]` section in `config.toml`:

```toml
[strategy]
maker_edge_threshold = 2
taker_edge_threshold = 5
min_edge_after_fees = 1
slippage_buffer_cents = 1
max_edge_threshold = 15  # NEW: Skip trades with edge > 15 cents
```

Default value: 15 cents.

### Behavior

When a trade signal has `edge > max_edge_threshold`:

1. **Action**: Return "MAX_EDGE" (displays in TUI Action column)
2. **Logging**: `tracing::warn!` with ticker, edge, fair value, bid/ask
3. **TUI log panel**: No entry pushed (keeps scrolling log clean)
4. **Trade**: Skipped (no order intent produced)

### Runtime Configuration

The threshold is editable in the TUI configuration page alongside other strategy parameters.

## Implementation

### Step 1: Config Changes

**File: `src/config.rs`**

Add to `StrategyConfig` struct:
```rust
pub max_edge_threshold: u8,  // Skip trades with edge above this (cents)
```

Add to `StrategyOverride` struct (for potential future per-sport overrides):
```rust
pub max_edge_threshold: Option<u8>,
```

Update `with_override()` to handle the new field.

Update config parsing and default value (15).

### Step 2: Pipeline Check

**File: `src/pipeline.rs`**

In `evaluate_matched_market()`, after calculating edge but before the trade action block (~line 1108):

```rust
// Max edge gate: skip suspiciously high edges
if signal.edge > strategy_config.max_edge_threshold as i32 {
    tracing::warn!(
        ticker = %ticker,
        edge = signal.edge,
        fair_value = fair,
        bid = bid,
        ask = ask,
        threshold = strategy_config.max_edge_threshold,
        "skipping trade: edge exceeds max threshold"
    );
    let row = MarketRow {
        // ... same as normal row but with action = "MAX_EDGE"
        action: "MAX_EDGE".to_string(),
        ..
    };
    return EvalOutcome::Evaluated(row, None);
}
```

### Step 3: TUI Config Page

**File: `src/tui/state.rs`**

Add `max_edge_threshold` to any runtime config state if needed for editing.

**File: `src/tui/render.rs`**

Add input field for max_edge_threshold in the configuration panel, similar to existing strategy thresholds.

### Step 4: Tests

Add unit test in `src/engine/strategy.rs` or `src/pipeline.rs` tests:
- Verify edge at threshold passes through
- Verify edge above threshold returns MAX_EDGE action

## Files Modified

1. `kalshi-arb/src/config.rs` - Add max_edge_threshold field
2. `kalshi-arb/src/pipeline.rs` - Add max edge check
3. `kalshi-arb/src/tui/state.rs` - Runtime config state (if needed)
4. `kalshi-arb/src/tui/render.rs` - Config page UI control
5. `kalshi-arb/config.toml` - Add default value
