# Expand Open Positions & Recent Trades Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add fullscreen focus mode with scrolling to the Open Positions (`o`) and Recent Trades (`t`) panels, matching the existing Markets/Logs expand pattern.

**Architecture:** Replicate the existing focus/scroll pattern (bool + offset) for two new panels. Each gets a layout branch in `draw()`, scroll-aware rendering, and keybindings in `tui_loop`.

**Tech Stack:** Rust, Ratatui 0.29, Crossterm 0.28

---

### Task 1: Add focus/scroll state fields

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs:6-26` (AppState struct)
- Modify: `kalshi-arb/src/tui/state.rs:77-98` (AppState::new)

**Step 1: Add fields to AppState struct**

In `state.rs`, add four new fields after `market_scroll_offset` (line 21):

```rust
    pub position_focus: bool,
    pub position_scroll_offset: usize,
    pub trade_focus: bool,
    pub trade_scroll_offset: usize,
```

**Step 2: Initialize fields in AppState::new**

In `state.rs`, add defaults after `market_scroll_offset: 0,` (line 93):

```rust
            position_focus: false,
            position_scroll_offset: 0,
            trade_focus: false,
            trade_scroll_offset: 0,
```

**Step 3: Build to verify**

Run: `cargo build --manifest-path kalshi-arb/Cargo.toml 2>&1 | tail -5`
Expected: compiles with no errors (warnings about dead_code are fine)

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/state.rs
git commit -m "feat(tui): add position/trade focus state fields"
```

---

### Task 2: Add event handling for position and trade focus

**Files:**
- Modify: `kalshi-arb/src/tui/mod.rs:49-53` (local UI state)
- Modify: `kalshi-arb/src/tui/mod.rs:57-63` (state copy before draw)
- Modify: `kalshi-arb/src/tui/mod.rs:72-145` (key event handling)

**Step 1: Add local state variables**

After line 53 (`let mut market_scroll_offset: usize = 0;`), add:

```rust
    let mut position_focus = false;
    let mut position_scroll_offset: usize = 0;
    let mut trade_focus = false;
    let mut trade_scroll_offset: usize = 0;
```

**Step 2: Copy local state into AppState before draw**

After line 62 (`state.market_scroll_offset = market_scroll_offset;`), add:

```rust
            state.position_focus = position_focus;
            state.position_scroll_offset = position_scroll_offset;
            state.trade_focus = trade_focus;
            state.trade_scroll_offset = trade_scroll_offset;
```

**Step 3: Add position focus key handler**

After the `} else if market_focus {` block (after line 122), add a new `else if` branch:

```rust
                        } else if position_focus {
                            match key.code {
                                KeyCode::Esc | KeyCode::Char('o') => {
                                    position_focus = false;
                                    position_scroll_offset = 0;
                                }
                                KeyCode::Char('j') | KeyCode::Down => {
                                    position_scroll_offset = position_scroll_offset.saturating_add(1);
                                }
                                KeyCode::Char('k') | KeyCode::Up => {
                                    position_scroll_offset = position_scroll_offset.saturating_sub(1);
                                }
                                KeyCode::Char('G') => {
                                    let total = if state_rx.borrow().sim_mode {
                                        state_rx.borrow().sim_positions.len()
                                    } else {
                                        state_rx.borrow().positions.len()
                                    };
                                    position_scroll_offset = total;
                                }
                                KeyCode::Char('g') => {
                                    position_scroll_offset = 0;
                                }
                                KeyCode::Char('q') => {
                                    let _ = cmd_tx.send(TuiCommand::Quit).await;
                                    return Ok(());
                                }
                                _ => {}
                            }
                        } else if trade_focus {
                            match key.code {
                                KeyCode::Esc | KeyCode::Char('t') => {
                                    trade_focus = false;
                                    trade_scroll_offset = 0;
                                }
                                KeyCode::Char('j') | KeyCode::Down => {
                                    trade_scroll_offset = trade_scroll_offset.saturating_add(1);
                                }
                                KeyCode::Char('k') | KeyCode::Up => {
                                    trade_scroll_offset = trade_scroll_offset.saturating_sub(1);
                                }
                                KeyCode::Char('G') => {
                                    let total = state_rx.borrow().trades.len();
                                    trade_scroll_offset = total;
                                }
                                KeyCode::Char('g') => {
                                    trade_scroll_offset = 0;
                                }
                                KeyCode::Char('q') => {
                                    let _ = cmd_tx.send(TuiCommand::Quit).await;
                                    return Ok(());
                                }
                                _ => {}
                            }
```

**Step 4: Add `o` and `t` keybindings in normal mode**

In the normal-mode `else` block, after line 141-142 (`market_focus = true; market_scroll_offset = 0;`), add two new arms before `_ => {}`:

```rust
                                KeyCode::Char('o') => {
                                    position_focus = true;
                                    position_scroll_offset = 0;
                                }
                                KeyCode::Char('t') => {
                                    trade_focus = true;
                                    trade_scroll_offset = 0;
                                }
```

**Step 5: Build to verify**

Run: `cargo build --manifest-path kalshi-arb/Cargo.toml 2>&1 | tail -5`
Expected: compiles (may warn about unused fields until render uses them)

**Step 6: Commit**

```bash
git add kalshi-arb/src/tui/mod.rs
git commit -m "feat(tui): add keybindings for position/trade focus modes"
```

---

### Task 3: Add layout branches and update rendering

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:14-71` (draw function - add layout branches)
- Modify: `kalshi-arb/src/tui/render.rs:289-347` (draw_positions - add scroll support)
- Modify: `kalshi-arb/src/tui/render.rs:349-374` (draw_trades - add scroll support)
- Modify: `kalshi-arb/src/tui/render.rs:424-459` (draw_footer - add focus hints)

**Step 1: Add position and trade focus layout branches in `draw()`**

In `render.rs`, after the `} else if state.market_focus {` block (after line 50), add two new branches before `} else {`:

```rust
    } else if state.position_focus {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(header_height),
                Constraint::Min(0),
                Constraint::Length(1),
            ])
            .split(f.area());

        draw_header(f, state, chunks[0], spinner_frame);
        draw_positions(f, state, chunks[1]);
        draw_footer(f, state, chunks[2]);
    } else if state.trade_focus {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(header_height),
                Constraint::Min(0),
                Constraint::Length(1),
            ])
            .split(f.area());

        draw_header(f, state, chunks[0], spinner_frame);
        draw_trades(f, state, chunks[1]);
        draw_footer(f, state, chunks[2]);
```

**Step 2: Update `draw_positions()` with scroll support**

Replace the existing `draw_positions` function (lines 289-347) with:

```rust
fn draw_positions(f: &mut Frame, state: &AppState, area: Rect) {
    let inner_width = area.width.saturating_sub(2) as usize;
    let fixed_cols: usize = 5 + 8 + 8 + 8; // qty+entry+sell+pnl = 29
    let ticker_w = inner_width.saturating_sub(fixed_cols).max(4);

    let header = Row::new(vec!["Ticker", "Qty", "Entry", "Sell @", "P&L"])
        .style(Style::default().add_modifier(Modifier::BOLD));

    let positions_source: Vec<PositionRow> = if state.sim_mode {
        state.sim_positions.iter().map(|sp| {
            let unrealized = (sp.sell_price as i32 - sp.entry_price as i32) * sp.quantity as i32
                - sp.entry_fee as i32;
            PositionRow {
                ticker: sp.ticker.clone(),
                quantity: sp.quantity,
                entry_price: sp.entry_price,
                sell_price: sp.sell_price,
                unrealized_pnl: unrealized,
            }
        }).collect()
    } else {
        state.positions.clone()
    };

    let rows: Vec<Row> = positions_source
        .iter()
        .map(|p| {
            let pnl_color = if p.unrealized_pnl >= 0 { Color::Green } else { Color::Red };
            let ticker = truncate_with_ellipsis(&p.ticker, ticker_w);
            Row::new(vec![
                Cell::from(ticker.into_owned()),
                Cell::from(p.quantity.to_string()),
                Cell::from(format!("{}c", p.entry_price)),
                Cell::from(format!("{}c", p.sell_price)),
                Cell::from(format!("{:+}c", p.unrealized_pnl))
                    .style(Style::default().fg(pnl_color)),
            ])
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

    let table = Table::new(
        rows,
        [
            Constraint::Length(ticker_w as u16),
            Constraint::Length(5),
            Constraint::Length(8),
            Constraint::Length(8),
            Constraint::Length(8),
        ],
    )
    .header(header)
    .block(
        Block::default()
            .title(title)
            .borders(Borders::ALL),
    );

    f.render_widget(table, area);
}
```

**Step 3: Update `draw_trades()` with scroll support**

Replace the existing `draw_trades` function (lines 349-374) with:

```rust
fn draw_trades(f: &mut Frame, state: &AppState, area: Rect) {
    let max_width = area.width.saturating_sub(2) as usize;
    let visible_lines = area.height.saturating_sub(2) as usize;

    let total = state.trades.len();
    let take_count = if state.trade_focus { total } else { 4 };

    let offset = if state.trade_focus {
        state.trade_scroll_offset.min(total.saturating_sub(visible_lines))
    } else {
        0
    };

    let lines: Vec<Line> = state
        .trades
        .iter()
        .rev()
        .skip(offset)
        .take(if state.trade_focus { visible_lines } else { take_count })
        .map(|t| {
            let pnl = t
                .pnl
                .map(|p| format!(" {:+}c", p))
                .unwrap_or_default();
            let raw = format!(
                " {} {} {}x {} @ {}c ({}){}",
                t.time, t.action, t.quantity, t.ticker, t.price, t.order_type, pnl
            );
            Line::from(truncate_with_ellipsis(&raw, max_width).into_owned())
        })
        .collect();

    let title = if state.trade_focus {
        format!(
            " Recent Trades [{}/{}] ",
            (offset + lines.len()).min(total),
            total,
        )
    } else {
        " Recent Trades ".to_string()
    };

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL);
    let para = Paragraph::new(lines).block(block);
    f.render_widget(para, area);
}
```

**Step 4: Update `draw_footer()` with position and trade focus hints**

Replace the existing `draw_footer` function (lines 424-459) with:

```rust
fn draw_footer(f: &mut Frame, state: &AppState, area: Rect) {
    let line = if state.log_focus || state.market_focus || state.position_focus || state.trade_focus {
        Line::from(vec![
            Span::styled("  [Esc]", Style::default().fg(Color::Yellow)),
            Span::raw(" back  "),
            Span::styled("[j/k]", Style::default().fg(Color::Yellow)),
            Span::raw(" scroll  "),
            Span::styled("[g/G]", Style::default().fg(Color::Yellow)),
            Span::raw(" top/bottom  "),
        ])
    } else {
        Line::from(vec![
            Span::styled("  [q]", Style::default().fg(Color::Yellow)),
            Span::raw("uit  "),
            Span::styled("[p]", Style::default().fg(Color::Yellow)),
            Span::raw("ause  "),
            Span::styled("[r]", Style::default().fg(Color::Yellow)),
            Span::raw("esume  "),
            Span::styled("[l]", Style::default().fg(Color::Yellow)),
            Span::raw("ogs  "),
            Span::styled("[m]", Style::default().fg(Color::Yellow)),
            Span::raw("arkets  "),
            Span::styled("[o]", Style::default().fg(Color::Yellow)),
            Span::raw("pen-pos  "),
            Span::styled("[t]", Style::default().fg(Color::Yellow)),
            Span::raw("rades  "),
        ])
    };
    let para = Paragraph::new(line);
    f.render_widget(para, area);
}
```

**Step 5: Build to verify**

Run: `cargo build --manifest-path kalshi-arb/Cargo.toml 2>&1 | tail -5`
Expected: compiles with no errors

**Step 6: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(tui): add fullscreen focus for positions and trades panels"
```

---

### Task 4: Verify and test

**Step 1: Run clippy**

Run: `cargo clippy --manifest-path kalshi-arb/Cargo.toml 2>&1 | tail -20`
Expected: no errors, fix any warnings

**Step 2: Run tests**

Run: `cargo test --manifest-path kalshi-arb/Cargo.toml 2>&1 | tail -20`
Expected: all existing tests pass

**Step 3: Final commit (if clippy fixes needed)**

```bash
git add -A && git commit -m "fix: address clippy warnings"
```
