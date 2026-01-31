# WebSocket Display Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 200ms display tick that patches Bid/Ask/Edge on MarketRows from `live_book`, so the Live Market table updates at near-WebSocket speed instead of the 5-25s odds polling cadence.

**Architecture:** A new `tokio::spawn` task runs a 200ms interval loop. Each tick clones the `live_book` HashMap, then calls `state_tx.send_modify()` to patch `bid`, `ask`, and `edge` on existing `MarketRow`s in-place. The odds polling loop continues to own full recomputes (fair_value, momentum, action, signals, sim trades). No new structs, dependencies, or synchronization primitives.

**Tech Stack:** Rust, Tokio (async runtime), `watch::Sender` (state channel)

**Design doc:** `docs/plans/2026-01-30-ws-display-refresh-design.md`

---

### Task 1: Add the WS display refresh tick

**Files:**
- Modify: `kalshi-arb/src/main.rs:1216-1218` (insert between Phase 4 WS handler and Phase 5 TUI)

**Step 1: Add the display tick task**

Insert after line 1216 (`});` closing the Phase 4 WS event handler), before line 1218 (`// --- Phase 5`):

```rust
    // --- Phase 4b: WS display refresh tick (200ms) ---
    // Patches Bid/Ask/Edge on existing MarketRows from live orderbook
    // so the TUI updates at near-WebSocket speed between odds poll cycles.
    let live_book_display = live_book.clone();
    let state_tx_display = state_tx.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        loop {
            interval.tick().await;
            // Clone the book snapshot and release the lock immediately
            let snapshot = if let Ok(book) = live_book_display.lock() {
                book.clone()
            } else {
                continue;
            };
            if snapshot.is_empty() {
                continue;
            }
            state_tx_display.send_modify(|state| {
                for row in &mut state.markets {
                    if let Some(&(yb, ya, _, _)) = snapshot.get(&row.ticker) {
                        if ya > 0 {
                            row.bid = yb;
                            row.ask = ya;
                            row.edge = row.fair_value as i32 - ya as i32;
                        }
                    }
                }
            });
        }
    });
```

**Step 2: Build and verify**

Run:
```bash
cd kalshi-arb && cargo build 2>&1
```
Expected: compiles with no errors. No warnings related to the new code.

**Step 3: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat: add 200ms WS display refresh tick for real-time Bid/Ask/Edge"
```

---

### Task 2: Manual smoke test

**Step 1: Run the application**

```bash
cd kalshi-arb && cargo run 2>&1
```

**Step 2: Verify behavior**

Observe the Live Market table:
- Bid/Ask columns should visibly update between odds poll cycles
- Edge column should recompute as ask moves
- No flicker, no panics, no lock contention warnings in logs
- The "Kalshi WS connected" log message should appear (confirms WebSocket is active)

**Step 3: Verify no regression**

- Momentum, Action, Staleness columns should still update on their normal cadence
- Sim trades (if enabled) should still trigger correctly
- Pausing/resuming the engine should work as before

---

### Done

That's the full implementation. One task modifies one file with ~20 lines of additive code. No existing logic is changed.
