# Fix Stale Kalshi Prices in Live Market

**Date:** 2026-01-30
**Branch:** fix/stale-kalshi-prices

## Problem

Kalshi bid/ask prices in the Live Market TUI freeze after initial load. The user observed prices on Kalshi's website changing during an active game while our dashboard showed the same values indefinitely.

## Root Cause

Delta events from the Kalshi WebSocket never update `live_book`.

The WebSocket subscribes to the `orderbook_delta` channel (ws.rs:88), which sends one initial `orderbook_snapshot` followed by incremental `orderbook_delta` messages for all subsequent price changes.

- **Snapshot handler** (main.rs:1253): Extracts best bid/ask and calls `live_book.insert()`. Works correctly but only fires once per connection.
- **Delta handler** (main.rs:1318): Only performs sim fill detection. Never updates `live_book`.
- **Display tick** (main.rs:1371): Reads from `live_book` every 200ms to patch TUI rows. Since `live_book` never changes after the initial snapshot, prices freeze.

The current `LiveBook` type stores flat `(yes_bid, yes_ask, no_bid, no_ask)` tuples, which cannot be incrementally updated from delta messages (a delta specifies a quantity change at one price level).

## Solution

Replace the flat tuple cache with a full depth book that supports both snapshot replacement and incremental delta application.

### Data Structure

```rust
// Before:
type LiveBook = Arc<Mutex<HashMap<String, (u32, u32, u32, u32)>>>;

// After:
type LiveBook = Arc<Mutex<HashMap<String, DepthBook>>>;

struct DepthBook {
    yes: HashMap<u32, i64>,  // price_cents -> quantity
    no: HashMap<u32, i64>,   // price_cents -> quantity
}
```

Methods on `DepthBook`:
- `apply_snapshot(snap)` — clears both sides, populates from snapshot (handles both dollar and legacy cent formats)
- `apply_delta(delta)` — adjusts quantity at one price level; removes entry if quantity <= 0
- `best_bid_ask() -> (u32, u32, u32, u32)` — derives (yes_bid, yes_ask, no_bid, no_ask) from current depth

### Changes

All changes in `src/main.rs`:

1. **Add `DepthBook` struct** near the `LiveBook` type alias (~line 80) with `new()`, `apply_snapshot()`, `apply_delta()`, `best_bid_ask()`.

2. **Phase 4 — Snapshot handler** (lines 1253-1280): Replace manual bid/ask extraction with `depth_book.apply_snapshot(snap)`. Remove inline price derivation (moved into `DepthBook::best_bid_ask()`).

3. **Phase 4 — Delta handler** (lines 1318-1361): Add `depth_book.apply_delta(delta)` before sim fill detection. This is the key fix.

4. **Phase 4b — Display tick** (lines 1371-1397): Call `depth_book.best_bid_ask()` instead of reading flat tuples. Patching logic unchanged.

5. **Sim fill detection** (both snapshot and delta handlers): Derive `yes_bid` from `depth_book.best_bid_ask()` instead of inline extraction or flat cache lookup.

### Files Changed

- `src/main.rs` — all changes (struct addition, three handler updates, display tick update)

### Testing

- Existing 91 tests must pass (no public API changes).
- Manual verification: run with `--simulate`, confirm bid/ask columns update during a live game.
- Add unit tests for `DepthBook`: snapshot application, delta application, best bid/ask derivation, edge cases (empty book, zero quantity removal).
