# Design: WebSocket-Driven Display Refresh

**Date**: 2026-01-30
**Status**: Approved

## Problem

The Kalshi WebSocket delivers sub-second orderbook updates to `live_book`, but the Live Market table only refreshes Bid/Ask/Edge when the odds polling loop runs (every 5-25 seconds). The displayed data can be significantly stale even though real-time data is available in memory.

## Solution

Add a 200ms display tick that patches Bid/Ask/Edge on existing MarketRows using the latest `live_book` data, independent of the odds polling cycle.

### Architecture

```
WebSocket events ──→ live_book HashMap (every event, unthrottled)
                          │
                          ├──→ Odds polling loop reads live_book (every 5-25s)
                          │    Full recompute: fair_value, momentum, action, signals, sim trades
                          │    Writes complete Vec<MarketRow> to state.markets
                          │
                          └──→ NEW: Display tick reads live_book (every 200ms)
                               Patches bid/ask/edge on existing rows only
                               Recomputes edge = fair_value - ask using cached fair_value
```

### Approach: WS-driven display tick (Approach A)

A new `tokio::spawn` task with a 200ms `tokio::time::interval`:

1. Lock `live_book`, clone contents, release lock immediately
2. `state_tx.send_modify()` to patch `state.markets` in-place
3. For each `MarketRow`, look up `live_book[row.ticker]`
4. If found and `yes_ask > 0`: update `row.bid`, `row.ask`, recompute `row.edge`
5. If not found or empty markets: skip (preserves REST fallback data)

### What this does NOT change

- The engine remains unthrottled (every WS event updates `live_book` immediately)
- The odds polling loop still owns: fair_value, momentum, action, signal evaluation, sim trades
- No changes to `MarketRow`, `AppState`, `process_sport_updates()`, WS handler, or TUI renderer

### Coordination

Both the odds loop and WS display tick write to `state.markets` via `watch::Sender::send_modify`. This serializes access — no race conditions, no new synchronization needed.

- Odds loop replaces rows entirely → next WS tick patches with fresh bid/ask (correct)
- WS tick patches rows → odds loop replaces entirely on next cycle (correct)
- Empty `state.markets` (pre-game sleep) → WS tick skips (no rows to patch)

### Scope

- **Files changed**: `main.rs` only (~20 lines added, 0 lines modified)
- **New dependencies**: none
- **Risk**: minimal — additive change, no existing logic modified
