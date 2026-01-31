# Enhanced Open Positions View — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the Open Positions table from 5 to 10 columns (Side, Bid, Edge, Mkt P&L, Age) with responsive column dropping.

**Architecture:** Add `live_book` field to shared `AppState` so the renderer has access to real-time bid/ask data. Rewrite `draw_positions()` with 10 columns, responsive layout, and age formatting. No new API calls or dependencies.

**Tech Stack:** Rust, ratatui, tokio watch channels

---

### Task 1: Add `live_book` field to `AppState`

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs:1` (add import)
- Modify: `kalshi-arb/src/tui/state.rs:26-61` (add field to struct)
- Modify: `kalshi-arb/src/tui/state.rs:113-151` (add field to constructor)

**Step 1: Add HashMap import**

At line 1, change:
```rust
use std::collections::VecDeque;
```
to:
```rust
use std::collections::{HashMap, VecDeque};
```

**Step 2: Add field to `AppState` struct**

After line 60 (`diagnostic_scroll_offset: usize,`), add:
```rust
    pub live_book: HashMap<String, (u32, u32, u32, u32)>,
```

**Step 3: Initialize in constructor**

After line 149 (`diagnostic_scroll_offset: 0,`), add:
```rust
            live_book: HashMap::new(),
```

**Step 4: Verify it compiles**

Run: `cargo check --manifest-path kalshi-arb/Cargo.toml 2>&1 | tail -5`
Expected: compiles successfully (possibly with warnings)

**Step 5: Commit**

```
feat(state): add live_book field to AppState
```

---

### Task 2: Plumb live book into `AppState` via 200ms refresh

**Files:**
- Modify: `kalshi-arb/src/main.rs:1366-1397` (the 200ms display refresh tokio::spawn)

**Step 1: Add `state.live_book = snapshot.clone();` inside `send_modify`**

In the 200ms display refresh loop, the `send_modify` closure currently only patches `state.markets`. Add one line at the start of the closure body, before the `for row in &mut state.markets` loop:

```rust
        state_tx_display.send_modify(|state| {
            state.live_book = snapshot.clone();
            for row in &mut state.markets {
```

This writes the full live book snapshot into `AppState` every 200ms so the renderer can access it.

**Step 2: Verify it compiles**

Run: `cargo check --manifest-path kalshi-arb/Cargo.toml 2>&1 | tail -5`
Expected: compiles successfully

**Step 3: Commit**

```
feat(main): plumb live_book into AppState on 200ms refresh
```

---

### Task 3: Rewrite `draw_positions()` with 10 columns

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:2` (add import for `calculate_fee`)
- Modify: `kalshi-arb/src/tui/render.rs:412-490` (rewrite `draw_positions`)

**Step 1: Add `calculate_fee` import**

At line 2, change:
```rust
use super::state::{AppState, PositionRow};
```
to:
```rust
use super::state::AppState;
use crate::engine::fees::calculate_fee;
```

(`PositionRow` is no longer needed — positions are rendered directly from `SimPosition`/live data.)

**Step 2: Add age formatting helper**

Add this function just above `draw_positions` (before line 412):

```rust
fn format_age(elapsed: std::time::Duration) -> String {
    let secs = elapsed.as_secs();
    if secs < 60 {
        format!("{}s", secs)
    } else if secs < 3600 {
        format!("{}m", secs / 60)
    } else {
        format!("{}h{:02}m", secs / 3600, (secs % 3600) / 60)
    }
}
```

**Step 3: Replace `draw_positions` entirely (lines 412-490)**

Replace the full function with:

```rust
fn draw_positions(f: &mut Frame, state: &AppState, area: Rect) {
    let inner_width = area.width.saturating_sub(2) as usize;

    // Responsive column dropping.
    // Fixed column widths: Side=4 Qty=5 Entry=6 Bid=5 Sell=6 Edge=6 Tgt=7 Mkt=7 Age=6 = 52
    // Drop order: Edge(6), Side(4), Age(6), Mkt(7)
    let show_edge = inner_width >= 56;
    let show_side = inner_width >= 48;
    let show_age = inner_width >= 44;
    let show_mkt = inner_width >= 38;

    let fixed: usize = 5 + 6 + 5 + 6 + 7  // Qty + Entry + Bid + Sell@ + Tgt (always shown)
        + if show_mkt { 7 } else { 0 }
        + if show_age { 6 } else { 0 }
        + if show_side { 4 } else { 0 }
        + if show_edge { 6 } else { 0 };
    let ticker_w = inner_width.saturating_sub(fixed).max(4);

    // Build header
    let mut headers: Vec<&str> = vec!["Ticker"];
    if show_side { headers.push("Side"); }
    headers.extend_from_slice(&["Qty", "Entry", "Bid", "Sell @"]);
    if show_edge { headers.push("Edge"); }
    headers.push("Tgt");
    if show_mkt { headers.push("Mkt"); }
    if show_age { headers.push("Age"); }

    let header = Row::new(headers)
        .style(Style::default().add_modifier(Modifier::BOLD));

    // Build constraints
    let mut constraints: Vec<Constraint> = vec![Constraint::Length(ticker_w as u16)];
    if show_side { constraints.push(Constraint::Length(4)); }
    constraints.extend_from_slice(&[
        Constraint::Length(5),
        Constraint::Length(6),
        Constraint::Length(5),
        Constraint::Length(6),
    ]);
    if show_edge { constraints.push(Constraint::Length(6)); }
    constraints.push(Constraint::Length(7));
    if show_mkt { constraints.push(Constraint::Length(7)); }
    if show_age { constraints.push(Constraint::Length(6)); }

    let now = std::time::Instant::now();

    // Build rows from sim_positions (or real positions)
    let positions = if state.sim_mode {
        &state.sim_positions
    } else {
        &state.sim_positions // TODO: use state.positions when real mode implemented
    };

    let rows: Vec<Row> = positions
        .iter()
        .map(|sp| {
            let ticker = truncate_with_ellipsis(&sp.ticker, ticker_w);

            // Look up live prices
            let (yes_bid, yes_ask) = state.live_book
                .get(&sp.ticker)
                .map(|&(yb, ya, _, _)| (yb, ya))
                .unwrap_or((0, 0));

            // Look up fair value from markets
            let fair_value = state.markets
                .iter()
                .find(|m| m.ticker == sp.ticker)
                .map(|m| m.fair_value)
                .unwrap_or(0);

            // Target P&L: (sell@ - entry) * qty - entry_fee
            let tgt_pnl = (sp.sell_price as i32 - sp.entry_price as i32) * sp.quantity as i32
                - sp.entry_fee as i32;
            let tgt_color = if tgt_pnl >= 0 { Color::Green } else { Color::Red };

            // Mkt P&L: (bid * qty - exit_fee) - (entry * qty + entry_fee)
            let mkt_pnl = if yes_bid > 0 {
                let exit_revenue = (yes_bid as i64) * (sp.quantity as i64);
                let exit_fee = calculate_fee(yes_bid, sp.quantity, true) as i64;
                let entry_cost = (sp.entry_price as i64) * (sp.quantity as i64) + sp.entry_fee as i64;
                (exit_revenue - exit_fee - entry_cost) as i32
            } else {
                -((sp.entry_price as i32) * (sp.quantity as i32) + sp.entry_fee as i32)
            };
            let mkt_color = if mkt_pnl >= 0 { Color::Green } else { Color::Red };

            // Edge: fair - ask
            let edge = if yes_ask > 0 { fair_value as i32 - yes_ask as i32 } else { 0 };
            let edge_color = if edge > 0 { Color::Green } else { Color::Red };

            // Age
            let age = format_age(now.duration_since(sp.filled_at));

            // Build cells
            let mut cells: Vec<Cell> = vec![Cell::from(ticker.into_owned())];

            if show_side {
                cells.push(Cell::from("YES").style(Style::default().fg(Color::Cyan)));
            }

            cells.extend_from_slice(&[
                Cell::from(sp.quantity.to_string()),
                Cell::from(format!("{}c", sp.entry_price)),
                Cell::from(if yes_bid > 0 { format!("{}c", yes_bid) } else { "--".to_string() })
                    .style(Style::default().fg(Color::Yellow)),
                Cell::from(format!("{}c", sp.sell_price)),
            ]);

            if show_edge {
                cells.push(
                    Cell::from(format!("{:+}", edge))
                        .style(Style::default().fg(edge_color)),
                );
            }

            cells.push(
                Cell::from(format!("{:+}c", tgt_pnl))
                    .style(Style::default().fg(tgt_color)),
            );

            if show_mkt {
                cells.push(
                    Cell::from(format!("{:+}c", mkt_pnl))
                        .style(Style::default().fg(mkt_color)),
                );
            }

            if show_age {
                cells.push(Cell::from(age));
            }

            Row::new(cells)
        })
        .collect();

    let visible_lines = area.height.saturating_sub(4) as usize;
    let total = rows.len();
    let offset = if state.position_focus {
        state.position_scroll_offset.min(total.saturating_sub(visible_lines))
    } else {
        0
    };

    let rows: Vec<Row> = rows.into_iter().skip(offset).take(visible_lines).collect();

    let title = if state.position_focus {
        format!(
            " Open Positions [{}/{}] ",
            (offset + rows.len()).min(total),
            total,
        )
    } else {
        " Open Positions ".to_string()
    };

    let table = Table::new(rows, constraints)
        .header(header)
        .block(
            Block::default()
                .title(title)
                .borders(Borders::ALL),
        );

    f.render_widget(table, area);
}
```

**Step 4: Verify it compiles**

Run: `cargo check --manifest-path kalshi-arb/Cargo.toml 2>&1 | tail -5`
Expected: compiles successfully (may have dead_code warning for `PositionRow` if no longer used)

**Step 5: Run existing tests**

Run: `cargo test --manifest-path kalshi-arb/Cargo.toml 2>&1 | tail -20`
Expected: all tests pass

**Step 6: Commit**

```
feat(tui): enhanced positions view with 10 responsive columns
```

---

### Task 4: Add unit test for `format_age`

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs` (add tests to existing `mod tests`)

**Step 1: Add tests to the existing `#[cfg(test)] mod tests` block**

Add inside the existing test module:

```rust
    #[test]
    fn test_format_age_seconds() {
        assert_eq!(format_age(std::time::Duration::from_secs(0)), "0s");
        assert_eq!(format_age(std::time::Duration::from_secs(45)), "45s");
        assert_eq!(format_age(std::time::Duration::from_secs(59)), "59s");
    }

    #[test]
    fn test_format_age_minutes() {
        assert_eq!(format_age(std::time::Duration::from_secs(60)), "1m");
        assert_eq!(format_age(std::time::Duration::from_secs(754)), "12m");
        assert_eq!(format_age(std::time::Duration::from_secs(3599)), "59m");
    }

    #[test]
    fn test_format_age_hours() {
        assert_eq!(format_age(std::time::Duration::from_secs(3600)), "1h00m");
        assert_eq!(format_age(std::time::Duration::from_secs(7380)), "2h03m");
    }
```

**Step 2: Run tests**

Run: `cargo test --manifest-path kalshi-arb/Cargo.toml -- tui::render::tests 2>&1 | tail -20`
Expected: all render tests pass

**Step 3: Commit**

```
test(tui): add format_age unit tests
```

---

### Task 5: Clean up dead code

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs` (check if `PositionRow` is still used)
- Modify: `kalshi-arb/src/tui/render.rs` (check import)

**Step 1: Check if `PositionRow` is referenced anywhere besides its definition**

Run: `grep -rn "PositionRow" kalshi-arb/src/`

If `PositionRow` is only referenced in its own struct definition and `state.positions` field, add `#[allow(dead_code)]` above the struct (it's needed for future real-mode support, same pattern as the existing `#[allow(dead_code)]` on `AppState`).

**Step 2: Run final check**

Run: `cargo check --manifest-path kalshi-arb/Cargo.toml 2>&1 | tail -10`
Expected: clean compile, no errors

**Step 3: Run all tests**

Run: `cargo test --manifest-path kalshi-arb/Cargo.toml 2>&1 | tail -20`
Expected: all tests pass

**Step 4: Commit (if changes were needed)**

```
chore: suppress dead_code warning for PositionRow
```
