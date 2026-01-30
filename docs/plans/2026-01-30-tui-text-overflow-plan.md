# TUI Text Overflow Protection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Protect all TUI sections against text overflow with ellipsis truncation, adaptive header layout, and a scrollable log focus mode.

**Architecture:** Add a `truncate_with_ellipsis` utility to `render.rs`, apply it across all draw functions, make the vertical layout dynamic based on terminal width and focus mode, and add UI-only state (`log_focus`, `log_scroll_offset`) to drive the new log focus mode.

**Tech Stack:** Rust, ratatui 0.29, crossterm 0.28, tokio

**Worktree:** `.worktrees/tui-overflow/` (branch: `feature/tui-text-overflow`)

---

### Task 1: Add truncation utility and tests

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:1-8` (add import, add function)

**Step 1: Write the truncation function with tests**

Add to top of `kalshi-arb/src/tui/render.rs`, after existing imports:

```rust
use std::borrow::Cow;
```

Add at the bottom of `kalshi-arb/src/tui/render.rs`:

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_short_string_unchanged() {
        assert_eq!(truncate_with_ellipsis("hello", 10), "hello");
    }

    #[test]
    fn test_truncate_exact_fit() {
        assert_eq!(truncate_with_ellipsis("hello", 5), "hello");
    }

    #[test]
    fn test_truncate_long_string() {
        assert_eq!(truncate_with_ellipsis("hello world", 8), "hello...");
    }

    #[test]
    fn test_truncate_very_small_width() {
        assert_eq!(truncate_with_ellipsis("hello", 2), "..");
    }

    #[test]
    fn test_truncate_width_3() {
        assert_eq!(truncate_with_ellipsis("hello", 3), "...");
    }

    #[test]
    fn test_truncate_width_4() {
        assert_eq!(truncate_with_ellipsis("hello", 4), "h...");
    }

    #[test]
    fn test_truncate_empty_string() {
        assert_eq!(truncate_with_ellipsis("", 5), "");
    }

    #[test]
    fn test_truncate_zero_width() {
        assert_eq!(truncate_with_ellipsis("hello", 0), "");
    }
}
```

**Step 2: Run tests to verify they pass**

Run: `cargo test --manifest-path kalshi-arb/Cargo.toml -- tui::render::tests -v`
Expected: all 8 new tests pass

**Step 3: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(tui): add truncate_with_ellipsis utility with tests"
```

---

### Task 2: Add UI state for log focus mode

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs:6-18` (add fields)

**Step 1: Add `log_focus` and `log_scroll_offset` fields to `AppState`**

Add two new fields to the `AppState` struct after `pub logs`:

```rust
pub log_focus: bool,
pub log_scroll_offset: usize,
```

Update `AppState::new()` to initialize them:

```rust
log_focus: false,
log_scroll_offset: 0,
```

**Step 2: Run tests to verify nothing breaks**

Run: `cargo test --manifest-path kalshi-arb/Cargo.toml`
Expected: all 17 existing + 8 new tests pass (25 total)

**Step 3: Commit**

```bash
git add kalshi-arb/src/tui/state.rs
git commit -m "feat(tui): add log_focus and log_scroll_offset to AppState"
```

---

### Task 3: Adaptive header with abbreviated labels and two-row wrapping

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:12-31` (`draw` function, dynamic constraints)
- Modify: `kalshi-arb/src/tui/render.rs:33-75` (`draw_header` function)

**Step 1: Rewrite `draw_header` with abbreviated labels and wrapping**

Replace the `draw_header` function with:

```rust
fn draw_header(f: &mut Frame, state: &AppState, area: Rect, spinner_frame: u8) {
    let kalshi_status = if state.kalshi_ws_connected {
        Span::styled("OK", Style::default().fg(Color::Green))
    } else {
        Span::styled("DOWN", Style::default().fg(Color::Red))
    };

    let activity_indicator = if state.is_paused {
        Span::styled(" PAUSED", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))
    } else {
        let ch = SPINNER_FRAMES[(spinner_frame as usize) % SPINNER_FRAMES.len()];
        Span::styled(
            format!(" {} RUN", ch),
            Style::default().fg(Color::Cyan),
        )
    };

    let bal = format!("${:.2}", state.balance_cents as f64 / 100.0);
    let exp = format!("${:.2}", state.total_exposure_cents as f64 / 100.0);
    let pnl_val = format!("${:.2}", state.realized_pnl_cents as f64 / 100.0);
    let uptime = state.uptime();

    let pnl_span = Span::styled(
        pnl_val.clone(),
        Style::default().fg(if state.realized_pnl_cents >= 0 {
            Color::Green
        } else {
            Color::Red
        }),
    );

    // Row 1 content: " Bal: $X.XX | Exp: $X.XX | P&L: $X.XX"
    // Row 2 content: " WS: OK | Up: Xh XXm | <activity>"
    // Measure row 1 approximate width
    let row1_width = 1 + 5 + bal.len() + 3 + 5 + exp.len() + 3 + 5 + pnl_val.len();

    let inner_width = area.width.saturating_sub(2) as usize; // borders

    let needs_wrap = row1_width + 3 + 4 + 4 + 3 + 4 + uptime.len() + 8 > inner_width;

    let lines = if needs_wrap {
        vec![
            Line::from(vec![
                Span::raw(format!(" Bal: {} | Exp: {} | P&L: ", bal, exp)),
                pnl_span,
            ]),
            Line::from(vec![
                Span::raw(" WS: "),
                kalshi_status,
                Span::raw(format!(" | Up: {}", uptime)),
                activity_indicator,
            ]),
        ]
    } else {
        vec![Line::from(vec![
            Span::raw(format!(" Bal: {} | Exp: {} | P&L: ", bal, exp)),
            pnl_span,
            Span::raw(" | WS: "),
            kalshi_status,
            Span::raw(format!(" | Up: {}", uptime)),
            activity_indicator,
        ])]
    };

    let block = Block::default()
        .title(" Kalshi Arb Engine ")
        .borders(Borders::ALL);
    let para = Paragraph::new(lines).block(block);
    f.render_widget(para, area);
}
```

**Step 2: Make `draw` compute header height dynamically**

Replace the `draw` function with:

```rust
pub fn draw(f: &mut Frame, state: &AppState, spinner_frame: u8) {
    let width = f.area().width.saturating_sub(2) as usize;

    let bal = format!("${:.2}", state.balance_cents as f64 / 100.0);
    let exp = format!("${:.2}", state.total_exposure_cents as f64 / 100.0);
    let pnl_val = format!("${:.2}", state.realized_pnl_cents as f64 / 100.0);
    let uptime = state.uptime();
    let row1_width = 1 + 5 + bal.len() + 3 + 5 + exp.len() + 3 + 5 + pnl_val.len();
    let full_width = row1_width + 3 + 4 + 4 + 3 + 4 + uptime.len() + 8;
    let header_height = if full_width > width { 4 } else { 3 };

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
}
```

**Step 3: Run tests and build**

Run: `cargo test --manifest-path kalshi-arb/Cargo.toml`
Run: `cargo build --manifest-path kalshi-arb/Cargo.toml`
Expected: all tests pass, build succeeds

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(tui): adaptive header with abbreviated labels and two-row wrapping"
```

---

### Task 4: Table overflow protection for markets and positions

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:77-163` (`draw_markets` and `draw_positions`)

**Step 1: Update `draw_markets` with ticker truncation and column dropping**

Replace the `draw_markets` function with:

```rust
fn draw_markets(f: &mut Frame, state: &AppState, area: Rect) {
    let inner_width = area.width.saturating_sub(2) as usize; // borders
    let fixed_cols_full: usize = 5 + 5 + 5 + 6 + 8 + 8; // fair+bid+ask+edge+action+latency = 37

    // Drop columns on narrow terminals
    let (headers, constraints, drop_latency, drop_action) = if inner_width < 45 {
        // Drop both Latency and Action
        let fixed = 5 + 5 + 5 + 6; // 21
        let ticker_w = inner_width.saturating_sub(fixed).max(4) as u16;
        (
            vec!["Ticker", "Fair", "Bid", "Ask", "Edge"],
            vec![
                Constraint::Length(ticker_w),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(6),
            ],
            true, true,
        )
    } else if inner_width < 55 {
        // Drop Latency only
        let fixed = 5 + 5 + 5 + 6 + 8; // 29
        let ticker_w = inner_width.saturating_sub(fixed).max(4) as u16;
        (
            vec!["Ticker", "Fair", "Bid", "Ask", "Edge", "Action"],
            vec![
                Constraint::Length(ticker_w),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(6),
                Constraint::Length(8),
            ],
            true, false,
        )
    } else {
        let ticker_w = inner_width.saturating_sub(fixed_cols_full).max(4) as u16;
        (
            vec!["Ticker", "Fair", "Bid", "Ask", "Edge", "Action", "Latency"],
            vec![
                Constraint::Length(ticker_w),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(6),
                Constraint::Length(8),
                Constraint::Length(8),
            ],
            false, false,
        )
    };

    let ticker_max = constraints[0].into();

    let header = Row::new(headers)
        .style(Style::default().add_modifier(Modifier::BOLD));

    let rows: Vec<Row> = state
        .markets
        .iter()
        .map(|m| {
            let edge_color = if m.edge > 0 { Color::Green } else { Color::Red };
            let ticker = truncate_with_ellipsis(&m.ticker, ticker_max);
            let mut cells = vec![
                Cell::from(ticker.into_owned()),
                Cell::from(m.fair_value.to_string()),
                Cell::from(m.bid.to_string()),
                Cell::from(m.ask.to_string()),
                Cell::from(format!("{:+}", m.edge))
                    .style(Style::default().fg(edge_color)),
            ];
            if !drop_action {
                cells.push(Cell::from(m.action.clone()));
            }
            if !drop_latency {
                cells.push(Cell::from(
                    m.latency_ms
                        .map(|l| format!("{}ms", l))
                        .unwrap_or_else(|| "--".to_string()),
                ));
            }
            Row::new(cells)
        })
        .collect();

    let table = Table::new(rows, constraints)
        .header(header)
        .block(
            Block::default()
                .title(" Live Markets ")
                .borders(Borders::ALL),
        );

    f.render_widget(table, area);
}
```

Note: `Constraint::Length(n).into()` doesn't give us the `usize` we want. We need to extract the ticker width differently. Replace `let ticker_max = constraints[0].into();` with extracting the value we already computed:

Actually, simplify — just compute `ticker_w` as a `usize` and use it directly. Change the approach: compute `ticker_w` as `usize` in each branch, return it alongside the other values. Replace the destructuring line with:

```rust
let (headers, constraints, ticker_w, drop_latency, drop_action) = if inner_width < 45 {
    let fixed = 5 + 5 + 5 + 6;
    let ticker_w = inner_width.saturating_sub(fixed).max(4);
    (
        vec!["Ticker", "Fair", "Bid", "Ask", "Edge"],
        vec![
            Constraint::Length(ticker_w as u16),
            Constraint::Length(5),
            Constraint::Length(5),
            Constraint::Length(5),
            Constraint::Length(6),
        ],
        ticker_w, true, true,
    )
} else if inner_width < 55 {
    let fixed = 5 + 5 + 5 + 6 + 8;
    let ticker_w = inner_width.saturating_sub(fixed).max(4);
    (
        vec!["Ticker", "Fair", "Bid", "Ask", "Edge", "Action"],
        vec![
            Constraint::Length(ticker_w as u16),
            Constraint::Length(5),
            Constraint::Length(5),
            Constraint::Length(5),
            Constraint::Length(6),
            Constraint::Length(8),
        ],
        ticker_w, true, false,
    )
} else {
    let ticker_w = inner_width.saturating_sub(fixed_cols_full).max(4);
    (
        vec!["Ticker", "Fair", "Bid", "Ask", "Edge", "Action", "Latency"],
        vec![
            Constraint::Length(ticker_w as u16),
            Constraint::Length(5),
            Constraint::Length(5),
            Constraint::Length(5),
            Constraint::Length(6),
            Constraint::Length(8),
            Constraint::Length(8),
        ],
        ticker_w, false, false,
    )
};
```

And then use `ticker_w` directly: `let ticker = truncate_with_ellipsis(&m.ticker, ticker_w);`

**Step 2: Update `draw_positions` with ticker truncation**

Replace the `draw_positions` function with:

```rust
fn draw_positions(f: &mut Frame, state: &AppState, area: Rect) {
    let inner_width = area.width.saturating_sub(2) as usize;
    let fixed_cols: usize = 5 + 8 + 8 + 8; // qty+entry+sell+pnl = 29
    let ticker_w = inner_width.saturating_sub(fixed_cols).max(4);

    let header = Row::new(vec!["Ticker", "Qty", "Entry", "Sell @", "P&L"])
        .style(Style::default().add_modifier(Modifier::BOLD));

    let rows: Vec<Row> = state
        .positions
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
            .title(" Open Positions ")
            .borders(Borders::ALL),
    );

    f.render_widget(table, area);
}
```

**Step 3: Run tests and build**

Run: `cargo test --manifest-path kalshi-arb/Cargo.toml`
Run: `cargo build --manifest-path kalshi-arb/Cargo.toml`
Expected: all tests pass, build succeeds

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(tui): table overflow protection with ticker truncation and column dropping"
```

---

### Task 5: Trades and logs truncation

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:165-218` (`draw_trades` and `draw_logs`)

**Step 1: Update `draw_trades` with line truncation**

Replace the `draw_trades` function with:

```rust
fn draw_trades(f: &mut Frame, state: &AppState, area: Rect) {
    let max_width = area.width.saturating_sub(2) as usize; // borders
    let lines: Vec<Line> = state
        .trades
        .iter()
        .rev()
        .take(4)
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

    let block = Block::default()
        .title(" Recent Trades ")
        .borders(Borders::ALL);
    let para = Paragraph::new(lines).block(block);
    f.render_widget(para, area);
}
```

**Step 2: Update `draw_logs` with line truncation and scroll support**

Replace the `draw_logs` function with:

```rust
fn draw_logs(f: &mut Frame, state: &AppState, area: Rect) {
    let max_width = area.width.saturating_sub(2) as usize; // borders
    let visible_lines = area.height.saturating_sub(2) as usize;

    let total = state.logs.len();
    let offset = if state.log_focus {
        state.log_scroll_offset.min(total.saturating_sub(visible_lines))
    } else {
        0
    };

    let lines: Vec<Line> = state
        .logs
        .iter()
        .rev()
        .skip(offset)
        .take(visible_lines)
        .map(|l| {
            let color = match l.level.as_str() {
                "ERROR" => Color::Red,
                "WARN" => Color::Yellow,
                "TRADE" => Color::Cyan,
                _ => Color::DarkGray,
            };
            let prefix = format!(" {} [{}] ", l.time, l.level);
            let prefix_len = prefix.len();
            let msg_max = max_width.saturating_sub(prefix_len);
            let msg = truncate_with_ellipsis(&l.message, msg_max);
            Line::from(vec![
                Span::styled(prefix, Style::default().fg(color)),
                Span::raw(msg.into_owned()),
            ])
        })
        .collect();

    let title = if state.log_focus {
        format!(" Engine Log [{}/{} lines] ", offset + visible_lines.min(total), total)
    } else {
        " Engine Log ".to_string()
    };

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL);
    let para = Paragraph::new(lines).block(block);
    f.render_widget(para, area);
}
```

**Step 3: Run tests and build**

Run: `cargo test --manifest-path kalshi-arb/Cargo.toml`
Run: `cargo build --manifest-path kalshi-arb/Cargo.toml`
Expected: all tests pass, build succeeds

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(tui): truncate trades and log lines with ellipsis and scroll support"
```

---

### Task 6: Footer and key event handling for log focus mode

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:220-231` (`draw_footer`)
- Modify: `kalshi-arb/src/tui/mod.rs:41-86` (`tui_loop`)

**Step 1: Update `draw_footer` for context-sensitive help**

Replace the `draw_footer` function with:

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
        ])
    };
    let para = Paragraph::new(line);
    f.render_widget(para, area);
}
```

**Step 2: Update `tui_loop` to handle new key events**

In `kalshi-arb/src/tui/mod.rs`, the `tui_loop` function needs to mutate `log_focus` and `log_scroll_offset`. Since `AppState` is received via a `watch::Receiver` (clone-on-read), we need separate UI-local state. Add local variables in `tui_loop` and merge them before drawing.

Replace the `tui_loop` function with:

```rust
async fn tui_loop(
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    mut state_rx: watch::Receiver<AppState>,
    cmd_tx: tokio::sync::mpsc::Sender<TuiCommand>,
) -> Result<()> {
    let mut ticker = tokio::time::interval(std::time::Duration::from_millis(100));
    let mut event_stream = EventStream::new();
    let mut spinner_frame: u8 = 0;
    let mut log_focus = false;
    let mut log_scroll_offset: usize = 0;

    loop {
        // Render current state with UI-local overrides
        {
            let mut state = state_rx.borrow().clone();
            state.log_focus = log_focus;
            state.log_scroll_offset = log_scroll_offset;
            terminal.draw(|f| render::draw(f, &state, spinner_frame))?;
        }

        tokio::select! {
            _ = ticker.tick() => {
                spinner_frame = spinner_frame.wrapping_add(1);
            }
            event = event_stream.next() => {
                if let Some(Ok(Event::Key(key))) = event {
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
                                _ => {}
                            }
                        }
                    }
                }
            }
            _ = state_rx.changed() => {}
        }
    }
}
```

**Step 3: Run tests and build**

Run: `cargo test --manifest-path kalshi-arb/Cargo.toml`
Run: `cargo build --manifest-path kalshi-arb/Cargo.toml`
Expected: all tests pass, build succeeds

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/render.rs kalshi-arb/src/tui/mod.rs
git commit -m "feat(tui): log focus mode with scrolling and context-sensitive footer"
```

---

### Task 7: Final verification

**Step 1: Run full test suite**

Run: `cargo test --manifest-path kalshi-arb/Cargo.toml`
Expected: all 25 tests pass

**Step 2: Run clippy**

Run: `cargo clippy --manifest-path kalshi-arb/Cargo.toml -- -D warnings`
Expected: no warnings

**Step 3: Fix any clippy issues and commit if needed**

```bash
git add -A
git commit -m "fix(tui): address clippy warnings"
```
