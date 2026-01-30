# TUI Text Overflow Protection Design

## Problem

The TUI has no explicit text overflow protection. It relies on ratatui's default clipping, which silently cuts off content at widget boundaries with no visual indication. This affects all sections: header, markets table, positions table, trades, and logs.

## Design

### Truncation Utility

A shared `truncate_with_ellipsis` helper in the render module:

```rust
fn truncate_with_ellipsis(s: &str, max_width: usize) -> Cow<'_, str> {
    if s.len() <= max_width {
        Cow::Borrowed(s)
    } else if max_width <= 3 {
        Cow::Owned(".".repeat(max_width))
    } else {
        Cow::Owned(format!("{}...", &s[..max_width - 3]))
    }
}
```

Applied everywhere text is rendered: table cells, log messages, trade strings, and header spans.

### Header Adaptive Layout

**Abbreviated labels** (always used):
- `"Balance:"` -> `"Bal:"`
- `"Exposure:"` -> `"Exp:"`
- `"Realized P&L:"` -> `"P&L:"`
- `"Kalshi:"` -> `"WS:"`
- `"Uptime:"` -> `"Up:"`

**Two-row wrapping** at render time: measure total width of all header spans. If it exceeds `area.width - 2`:
- Row 1: Bal, Exp, P&L (financial metrics)
- Row 2: WS status, Uptime, Spinner (system metrics)
- Header constraint changes from `Length(3)` to `Length(4)`

Layout constraints are computed dynamically based on terminal width. On extremely narrow terminals (< 40 cols), individual metric values are truncated with ellipsis.

### Table Overflow Protection

**Markets table** (Ticker, Fair, Bid, Ask, Edge, Action, Latency):
- Compute available ticker width: `area.width - 2 (borders) - sum_of_fixed_columns`
- Truncate ticker text with ellipsis to resolved width
- On very narrow terminals (< 50 cols), drop lowest-priority columns: Latency first, then Action

**Positions table** (Ticker, Qty, Entry, Sell @, P&L):
- Same computed ticker width approach
- Truncate ticker with ellipsis
- No column dropping needed (fewer columns)

**Trades section** (Paragraph with formatted strings):
- Truncate each line to `area.width - 2` with ellipsis

### Log Focus Mode

**New state:** `log_focus: bool` and `log_scroll_offset: usize` in UI state.

**Toggle:** Press `l` to enter, `Esc` to exit.

**Normal mode:** Unchanged layout. Log lines truncated with ellipsis to `area.width - 2`.

**Focus mode layout:**
- Header: `Length(3)` or `Length(4)` (adaptive)
- Logs: `Min(0)` (takes all remaining space)
- Footer: `Length(1)`
- Markets, positions, trades: `Length(0)` (hidden)

**Scrolling in focus mode:**
- `j` / `Down` -- scroll down (older)
- `k` / `Up` -- scroll up (newer)
- `G` -- jump to bottom (newest)
- `g` -- jump to top (oldest)
- Offset clamped to `0..logs.len()`

**Footer updates dynamically:**
- Normal: `[q]uit [p]ause [r]esume [l]ogs`
- Focus: `[Esc] back [j/k] scroll [g/G] top/bottom`

## Files Modified

- `tui/render.rs` -- truncation helper, dynamic layout, all draw functions updated
- `tui/state.rs` -- add `log_focus` and `log_scroll_offset` to UI state
- `tui/mod.rs` -- handle new key events (l, Esc, j, k, g, G)

## Not In Scope

- No horizontal scrolling
- No mouse support
- No resizable panes
- No per-section scroll (only logs in focus mode)
