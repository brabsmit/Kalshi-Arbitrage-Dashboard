# TUI Freeze Fix + Activity Spinner

## Problem

The TUI event loop in `tui/mod.rs` freezes after initial render. Line 72 (`state_rx.changed().await`) blocks indefinitely until a background task updates state. During 60-second gaps between odds polling cycles (or before the first cycle completes), the TUI cannot render, process keyboard input, or quit.

## Root Cause

```rust
loop {
    let state = state_rx.borrow().clone();
    terminal.draw(|f| render::draw(f, &state))?;
    if event::poll(Duration::from_millis(100))? { /* handle keys */ }
    let _ = state_rx.changed().await;  // BLOCKS HERE
}
```

`event::poll` is a blocking call (holds the thread for up to 100ms), and `state_rx.changed().await` suspends the async task indefinitely. Neither allows the other to proceed concurrently.

## Solution

### 1. Replace event loop with `tokio::select!`

Use three concurrent sources in a `tokio::select!`:
- **Tick interval** (100ms): drives rendering and spinner animation
- **Keyboard events**: via crossterm's async `EventStream` (requires `event-stream` feature + `futures` crate)
- **State changes**: via `state_rx.changed()`

Any of the three triggers a re-render.

### 2. Add spinner to header

- Add `spinner_frame: u8` to `AppState` (incremented each tick)
- Render braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) in the header
- Show static icon when paused

### Dependencies

- `crossterm`: add `event-stream` feature
- `futures`: add crate (for `StreamExt` on `EventStream`)

### Files Changed

- `kalshi-arb/Cargo.toml`: add features/deps
- `kalshi-arb/src/tui/mod.rs`: rewrite event loop
- `kalshi-arb/src/tui/state.rs`: add `spinner_frame` field
- `kalshi-arb/src/tui/render.rs`: render spinner in header
