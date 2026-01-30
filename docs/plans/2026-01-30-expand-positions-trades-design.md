# Expand Open Positions & Recent Trades Panels

## Summary

Add fullscreen focus mode to the Open Positions and Recent Trades TUI panels, matching the existing expand behavior of Markets (`m`) and Logs (`l`).

## Keys

- `o` — toggle fullscreen focus on Open Positions
- `t` — toggle fullscreen focus on Recent Trades

## Changes

### 1. State (`state.rs`)

Add to `AppState`:

- `position_focus: bool`
- `position_scroll_offset: usize`
- `trade_focus: bool`
- `trade_scroll_offset: usize`

### 2. Event Handling (`mod.rs`)

Add local UI state variables for `position_focus`, `position_scroll_offset`, `trade_focus`, `trade_scroll_offset`. Copy them into `AppState` before each draw call.

Add two new focus-mode key handler branches (position focus and trade focus), each supporting:

- `Esc` or toggle key (`o`/`t`) to exit focus
- `j` / Down to scroll down
- `k` / Up to scroll up
- `G` to jump to bottom
- `g` to jump to top
- `q` to quit

In normal mode, `o` enters position focus and `t` enters trade focus (resetting scroll offset to 0). Focus modes remain mutually exclusive.

### 3. Layout & Rendering (`render.rs`)

Add two new layout branches in `draw()`:

- **Position focus**: Header + fullscreen positions + footer
- **Trade focus**: Header + fullscreen trades + footer

Update `draw_positions()`:

- Accept scroll offset and available height
- Render all entries with scroll support when focused

Update `draw_trades()`:

- Accept scroll offset and available height
- Show all entries from the VecDeque (up to 100) when focused, not just the last 4

Update `draw_footer()`:

- Add contextual keybinding hints for position and trade focus modes

## Non-goals

- No inline resizing or configurable panel heights
- No changes to data structures or engine logic
