# Market Focus Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Live Markets section expandable to fullscreen with vim-style scrolling, mirroring the existing log focus mode.

**Architecture:** Add a `market_focus` toggle and `market_scroll_offset` to the TUI event loop, with a third layout branch in the renderer. The `m` key toggles focus mode; j/k/G/g scroll; Esc or `m` exits. Only one focus mode (log or market) can be active at a time.

**Tech Stack:** Rust, ratatui 0.29, crossterm 0.28

---

### Task 1: Add market focus state fields to AppState

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs:6-20`

**Step 1: Add `market_focus` and `market_scroll_offset` fields to `AppState`**

In `state.rs`, add two fields after `log_scroll_offset` (line 19):

```rust
pub struct AppState {
    pub balance_cents: i64,
    pub total_exposure_cents: i64,
    pub realized_pnl_cents: i64,
    pub kalshi_ws_connected: bool,
    pub odds_ws_connected: bool,
    pub start_time: Instant,
    pub is_paused: bool,
    pub markets: Vec<MarketRow>,
    pub positions: Vec<PositionRow>,
    pub trades: VecDeque<TradeRow>,
    pub logs: VecDeque<LogEntry>,
    pub log_focus: bool,
    pub log_scroll_offset: usize,
    pub market_focus: bool,
    pub market_scroll_offset: usize,
}
```

**Step 2: Initialize the new fields in `AppState::new()`**

Add after `log_scroll_offset: 0,` (line 75):

```rust
market_focus: false,
market_scroll_offset: 0,
```

**Step 3: Verify it compiles**

Run: `cargo check --manifest-path kalshi-arb/Cargo.toml`
Expected: Compiles with no errors (fields exist but are unused so far).

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/state.rs
git commit -m "feat(tui): add market_focus and market_scroll_offset to AppState"
```

---

### Task 2: Add market focus key bindings to event loop

**Files:**
- Modify: `kalshi-arb/src/tui/mod.rs:41-118`

**Step 1: Add `market_focus` and `market_scroll_offset` local state variables**

In `tui_loop()`, after line 50 (`let mut log_scroll_offset: usize = 0;`), add:

```rust
let mut market_focus = false;
let mut market_scroll_offset: usize = 0;
```

**Step 2: Pass market focus state to the renderer**

In the render block (lines 54-59), add the market focus fields alongside the log focus fields:

```rust
{
    let mut state = state_rx.borrow().clone();
    state.log_focus = log_focus;
    state.log_scroll_offset = log_scroll_offset;
    state.market_focus = market_focus;
    state.market_scroll_offset = market_scroll_offset;
    terminal.draw(|f| render::draw(f, &state, spinner_frame))?;
}
```

**Step 3: Add market focus key handling branch**

Restructure the key handling block (lines 67-111). The logic becomes a three-way branch: log focus, market focus, or normal mode. Replace the entire `if key.kind == KeyEventKind::Press` block with:

```rust
if key.kind == KeyEventKind::Press {
    if log_focus {
        match key.code {
            KeyCode::Esc | KeyCode::Char('l') => {
                log_focus = false;
                log_scroll_offset = 0;
            }
            KeyCode::Char('j') | KeyCode::Down => {
                log_scroll_offset = log_scroll_offset.saturating_add(1);
            }
            KeyCode::Char('k') | KeyCode::Up => {
                log_scroll_offset = log_scroll_offset.saturating_sub(1);
            }
            KeyCode::Char('G') => {
                let total = state_rx.borrow().logs.len();
                log_scroll_offset = total;
            }
            KeyCode::Char('g') => {
                log_scroll_offset = 0;
            }
            KeyCode::Char('q') => {
                let _ = cmd_tx.send(TuiCommand::Quit).await;
                return Ok(());
            }
            _ => {}
        }
    } else if market_focus {
        match key.code {
            KeyCode::Esc | KeyCode::Char('m') => {
                market_focus = false;
                market_scroll_offset = 0;
            }
            KeyCode::Char('j') | KeyCode::Down => {
                market_scroll_offset = market_scroll_offset.saturating_add(1);
            }
            KeyCode::Char('k') | KeyCode::Up => {
                market_scroll_offset = market_scroll_offset.saturating_sub(1);
            }
            KeyCode::Char('G') => {
                let total = state_rx.borrow().markets.len();
                market_scroll_offset = total;
            }
            KeyCode::Char('g') => {
                market_scroll_offset = 0;
            }
            KeyCode::Char('q') => {
                let _ = cmd_tx.send(TuiCommand::Quit).await;
                return Ok(());
            }
            _ => {}
        }
    } else {
        match key.code {
            KeyCode::Char('q') => {
                let _ = cmd_tx.send(TuiCommand::Quit).await;
                return Ok(());
            }
            KeyCode::Char('p') => {
                let _ = cmd_tx.send(TuiCommand::Pause).await;
            }
            KeyCode::Char('r') => {
                let _ = cmd_tx.send(TuiCommand::Resume).await;
            }
            KeyCode::Char('l') => {
                log_focus = true;
                log_scroll_offset = 0;
            }
            KeyCode::Char('m') => {
                market_focus = true;
                market_scroll_offset = 0;
            }
            _ => {}
        }
    }
}
```

**Step 4: Verify it compiles**

Run: `cargo check --manifest-path kalshi-arb/Cargo.toml`
Expected: Compiles. May have warnings about unused `market_focus`/`market_scroll_offset` in state since render doesn't use them yet.

**Step 5: Commit**

```bash
git add kalshi-arb/src/tui/mod.rs
git commit -m "feat(tui): add market focus key bindings with vim-style scrolling"
```

---

### Task 3: Add market focus layout branch and scrolling to renderer

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:14-58` (draw function)
- Modify: `kalshi-arb/src/tui/render.rs:128-220` (draw_markets function)
- Modify: `kalshi-arb/src/tui/render.rs:342-366` (draw_footer function)

**Step 1: Add market focus layout branch in `draw()`**

Replace the `if state.log_focus { ... } else { ... }` block (lines 25-57) with a three-way branch:

```rust
if state.log_focus {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(header_height),
            Constraint::Min(0),
            Constraint::Length(1),
        ])
        .split(f.area());

    draw_header(f, state, chunks[0], spinner_frame);
    draw_logs(f, state, chunks[1]);
    draw_footer(f, state, chunks[2]);
} else if state.market_focus {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(header_height),
            Constraint::Min(0),
            Constraint::Length(1),
        ])
        .split(f.area());

    draw_header(f, state, chunks[0], spinner_frame);
    draw_markets(f, state, chunks[1]);
    draw_footer(f, state, chunks[2]);
} else {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(header_height),
            Constraint::Min(8),
            Constraint::Length(6),
            Constraint::Length(6),
            Constraint::Min(5),
            Constraint::Length(1),
        ])
        .split(f.area());

    draw_header(f, state, chunks[0], spinner_frame);
    draw_markets(f, state, chunks[1]);
    draw_positions(f, state, chunks[2]);
    draw_trades(f, state, chunks[3]);
    draw_logs(f, state, chunks[4]);
    draw_footer(f, state, chunks[5]);
}
```

**Step 2: Add scroll offset support to `draw_markets()`**

The current `draw_markets()` renders all rows with no scrolling. Add scroll offset logic after the rows are built.

In `draw_markets()`, after the `rows` vec is constructed (line 209) and before the table is created (line 211), add scroll offset handling. Replace lines 211-219 with:

```rust
let visible_lines = area.height.saturating_sub(4) as usize; // borders + header row + padding
let total = rows.len();
let offset = if state.market_focus {
    state.market_scroll_offset.min(total.saturating_sub(visible_lines))
} else {
    0
};

let rows: Vec<Row> = rows.into_iter().skip(offset).take(visible_lines).collect();

let title = if state.market_focus {
    format!(
        " Live Markets [{}/{} rows] ",
        (offset + rows.len()).min(total),
        total,
    )
} else {
    " Live Markets ".to_string()
};

let table = Table::new(rows, constraints)
    .header(header)
    .block(
        Block::default()
            .title(title)
            .borders(Borders::ALL),
    );

f.render_widget(table, area);
```

**Step 3: Update `draw_footer()` for market focus mode**

Replace the `draw_footer()` function (lines 342-366) with a three-way branch:

```rust
fn draw_footer(f: &mut Frame, state: &AppState, area: Rect) {
    let line = if state.log_focus {
        Line::from(vec![
            Span::styled("  [Esc]", Style::default().fg(Color::Yellow)),
            Span::raw(" back  "),
            Span::styled("[j/k]", Style::default().fg(Color::Yellow)),
            Span::raw(" scroll  "),
            Span::styled("[g/G]", Style::default().fg(Color::Yellow)),
            Span::raw(" top/bottom  "),
        ])
    } else if state.market_focus {
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
        ])
    };
    let para = Paragraph::new(line);
    f.render_widget(para, area);
}
```

Note: The normal mode footer now also shows `[m]arkets` so users discover the keybinding.

**Step 4: Verify it compiles**

Run: `cargo check --manifest-path kalshi-arb/Cargo.toml`
Expected: Compiles with no errors or warnings.

**Step 5: Run existing tests**

Run: `cargo test --manifest-path kalshi-arb/Cargo.toml`
Expected: All existing `truncate_with_ellipsis` tests pass.

**Step 6: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(tui): market focus mode with fullscreen layout and scrolling"
```

---

### Task 4: Manual verification

**Step 1: Build and run**

Run: `cargo build --manifest-path kalshi-arb/Cargo.toml`
Expected: Clean build.

**Step 2: Manual test checklist**

If the app can be run (API keys available), verify:

- [ ] Normal mode shows all sections; footer shows `[m]arkets`
- [ ] Press `m` → markets expand to full screen with header + footer
- [ ] Title shows `[X/Y rows]` count
- [ ] `j`/`Down` scrolls down, `k`/`Up` scrolls up
- [ ] `G` jumps to bottom, `g` jumps to top
- [ ] Scroll clamps at boundaries (no over-scroll)
- [ ] `Esc` or `m` exits back to normal view
- [ ] `q` quits from market focus mode
- [ ] Pressing `l` in normal mode still works (log focus)
- [ ] Cannot enter both focus modes simultaneously
- [ ] Footer shows correct hints in each mode
