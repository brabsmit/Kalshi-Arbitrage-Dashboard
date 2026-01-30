# Simulation Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add paper-trading simulation mode that tracks virtual positions, simulates fills from live orderbook data, and displays results with a blue header indicating simulation mode.

**Architecture:** A `--simulate` CLI flag activates sim mode. Sim state (balance, positions, P&L) lives on `AppState`. Buy signals trigger virtual position creation in the odds polling loop. Fill detection runs in the WebSocket processing loop by checking if best_bid crosses the sell price.

**Tech Stack:** Rust, ratatui, tokio, std::env::args (no new dependencies)

---

### Task 1: Add SimPosition struct and sim fields to AppState

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs:1-109`

**Step 1: Add SimPosition struct after TradeRow**

Add this struct after `TradeRow` (after line 53):

```rust
#[derive(Debug, Clone)]
pub struct SimPosition {
    pub ticker: String,
    pub quantity: u32,
    pub entry_price: u32,
    pub sell_price: u32,
    pub entry_fee: u32,
    pub filled_at: Instant,
}
```

**Step 2: Add sim fields to AppState**

Add these fields after `market_scroll_offset` (line 21):

```rust
    pub sim_mode: bool,
    pub sim_balance_cents: i64,
    pub sim_positions: Vec<SimPosition>,
    pub sim_realized_pnl_cents: i64,
```

**Step 3: Initialize sim fields in AppState::new()**

Add to the `Self { ... }` block in `new()`, after `market_scroll_offset: 0,`:

```rust
            sim_mode: false,
            sim_balance_cents: 100_000,
            sim_positions: Vec::new(),
            sim_realized_pnl_cents: 0,
```

**Step 4: Verify it compiles**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo check 2>&1`
Expected: compiles with no errors (warnings OK)

**Step 5: Commit**

```bash
git add kalshi-arb/src/tui/state.rs
git commit -m "feat(sim): add SimPosition struct and sim fields to AppState"
```

---

### Task 2: Parse --simulate CLI flag and wire into AppState

**Files:**
- Modify: `kalshi-arb/src/main.rs:1-50` (top of main fn)

**Step 1: Parse CLI flag**

Add right after `tracing_subscriber` init (after line 26), before `let config = ...`:

```rust
    let sim_mode = std::env::args().any(|arg| arg == "--simulate");
```

**Step 2: Set sim_mode on AppState**

Find the line `let (state_tx, state_rx) = watch::channel(AppState::new());` (line 53).
Replace with:

```rust
    let (state_tx, state_rx) = watch::channel({
        let mut s = AppState::new();
        s.sim_mode = sim_mode;
        s
    });
```

**Step 3: Print sim mode status at startup**

After the `println!("  Loading API credentials ...");` block (after line 39), add:

```rust
    if sim_mode {
        println!("  ** SIMULATION MODE ** ($1000 virtual balance)");
        println!();
    }
```

**Step 4: Skip real balance fetch in sim mode**

Wrap the existing balance fetch block (lines 138-148) with:

```rust
    if !sim_mode {
        // ... existing balance fetch code ...
    }
```

**Step 5: Verify it compiles**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo check 2>&1`
Expected: compiles with no errors

**Step 6: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat(sim): parse --simulate CLI flag and wire into AppState"
```

---

### Task 3: Add simulated buy logic after signal evaluation

**Files:**
- Modify: `kalshi-arb/src/main.rs:194-307` (odds polling loop)
- Reference: `kalshi-arb/src/engine/fees.rs` (calculate_fee)

**Step 1: Import fees module**

Add to the existing imports at top of main.rs (near line 9):

```rust
use engine::fees::calculate_fee;
```

**Step 2: Clone sim_mode into the engine spawn**

Before the `tokio::spawn(async move {` for the odds polling loop (near line 170), add:

```rust
    let sim_mode_engine = sim_mode;
```

**Step 3: Add sim buy logic after the dry-run log**

After the existing signal log block (after line 277, the closing `}` of `if signal.action != TradeAction::Skip`), add:

```rust
                                        // Sim mode: place virtual buy
                                        if sim_mode_engine && signal.action != strategy::TradeAction::Skip {
                                            let entry_price = signal.price;
                                            let qty = (5000u32 / entry_price).max(1);
                                            let entry_cost = (qty * entry_price) as i64;
                                            let entry_fee = calculate_fee(entry_price, qty, true) as i64;
                                            let total_cost = entry_cost + entry_fee;

                                            state_tx_engine.send_modify(|s| {
                                                // Skip if insufficient balance or duplicate ticker
                                                if s.sim_balance_cents < total_cost {
                                                    return;
                                                }
                                                if s.sim_positions.iter().any(|p| p.ticker == mkt.ticker) {
                                                    return;
                                                }

                                                s.sim_balance_cents -= total_cost;
                                                s.sim_positions.push(tui::state::SimPosition {
                                                    ticker: mkt.ticker.clone(),
                                                    quantity: qty,
                                                    entry_price,
                                                    sell_price: fair,
                                                    entry_fee: entry_fee as u32,
                                                    filled_at: std::time::Instant::now(),
                                                });
                                                s.push_trade(tui::state::TradeRow {
                                                    time: chrono::Local::now().format("%H:%M:%S").to_string(),
                                                    action: "BUY".to_string(),
                                                    ticker: mkt.ticker.clone(),
                                                    price: entry_price,
                                                    quantity: qty,
                                                    order_type: "SIM".to_string(),
                                                    pnl: None,
                                                });
                                                s.push_log("TRADE", format!(
                                                    "SIM BUY {}x {} @ {}¢, sell target {}¢",
                                                    qty, mkt.ticker, entry_price, fair
                                                ));
                                            });
                                        }
```

**Step 4: Skip real balance refresh in sim mode**

Wrap the balance refresh block (lines 297-302) with:

```rust
            if !sim_mode_engine {
                // ... existing balance refresh ...
            }
```

**Step 5: Verify it compiles**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo check 2>&1`
Expected: compiles with no errors

**Step 6: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat(sim): add virtual buy logic on strategy signals"
```

---

### Task 4: Add fill detection in WebSocket processing loop

**Files:**
- Modify: `kalshi-arb/src/main.rs:310-361` (Phase 4 WS event loop)

**Step 1: Clone sim_mode for WS spawn**

Before the Phase 4 `tokio::spawn` (near line 312), add:

```rust
    let sim_mode_ws = sim_mode;
```

**Step 2: Add fill detection after orderbook update**

After the `Snapshot` match arm inserts into `live_book_ws` (after line 354, after the closing `}` of the `if let Ok(mut book)` block), add fill detection:

```rust
                    // Sim fill detection: check if any sim position's sell is filled
                    if sim_mode_ws {
                        let yes_bid = yes_bid;
                        let ticker = snap.market_ticker.clone();
                        state_tx_ws.send_modify(|s| {
                            let mut filled_indices = Vec::new();
                            for (i, pos) in s.sim_positions.iter().enumerate() {
                                if pos.ticker == ticker && yes_bid >= pos.sell_price {
                                    filled_indices.push(i);
                                }
                            }
                            for &i in filled_indices.iter().rev() {
                                let pos = s.sim_positions.remove(i);
                                let exit_revenue = (pos.quantity * pos.sell_price) as i64;
                                let exit_fee = calculate_fee(pos.sell_price, pos.quantity, false) as i64;
                                let entry_cost = (pos.quantity * pos.entry_price) as i64 + pos.entry_fee as i64;
                                let pnl = (exit_revenue - exit_fee) - entry_cost;

                                s.sim_balance_cents += exit_revenue - exit_fee;
                                s.sim_realized_pnl_cents += pnl;
                                s.push_trade(tui::state::TradeRow {
                                    time: chrono::Local::now().format("%H:%M:%S").to_string(),
                                    action: "SELL".to_string(),
                                    ticker: pos.ticker.clone(),
                                    price: pos.sell_price,
                                    quantity: pos.quantity,
                                    order_type: "SIM".to_string(),
                                    pnl: Some(pnl as i32),
                                });
                                s.push_log("TRADE", format!(
                                    "SIM SELL {}x {} @ {}¢, P&L: {:+}¢",
                                    pos.quantity, pos.ticker, pos.sell_price, pnl
                                ));
                            }
                        });
                    }
```

**Step 3: Add the same fill check in the Delta arm**

Replace the existing Delta arm (line 356-358):

```rust
                kalshi::ws::KalshiWsEvent::Delta(_delta) => {
                    // Delta events: also check for sim fills using live_book
                    if sim_mode_ws {
                        if let Ok(book) = live_book_ws.lock() {
                            let book_snapshot: Vec<(String, u32)> = book.iter()
                                .map(|(t, (yb, _, _, _))| (t.clone(), *yb))
                                .collect();
                            drop(book);
                            state_tx_ws.send_modify(|s| {
                                let mut filled_indices = Vec::new();
                                for (i, pos) in s.sim_positions.iter().enumerate() {
                                    if let Some((_, best_bid)) = book_snapshot.iter().find(|(t, _)| t == &pos.ticker) {
                                        if *best_bid >= pos.sell_price {
                                            filled_indices.push(i);
                                        }
                                    }
                                }
                                for &i in filled_indices.iter().rev() {
                                    let pos = s.sim_positions.remove(i);
                                    let exit_revenue = (pos.quantity * pos.sell_price) as i64;
                                    let exit_fee = calculate_fee(pos.sell_price, pos.quantity, false) as i64;
                                    let entry_cost = (pos.quantity * pos.entry_price) as i64 + pos.entry_fee as i64;
                                    let pnl = (exit_revenue - exit_fee) - entry_cost;

                                    s.sim_balance_cents += exit_revenue - exit_fee;
                                    s.sim_realized_pnl_cents += pnl;
                                    s.push_trade(tui::state::TradeRow {
                                        time: chrono::Local::now().format("%H:%M:%S").to_string(),
                                        action: "SELL".to_string(),
                                        ticker: pos.ticker.clone(),
                                        price: pos.sell_price,
                                        quantity: pos.quantity,
                                        order_type: "SIM".to_string(),
                                        pnl: Some(pnl as i32),
                                    });
                                    s.push_log("TRADE", format!(
                                        "SIM SELL {}x {} @ {}¢, P&L: {:+}¢",
                                        pos.quantity, pos.ticker, pos.sell_price, pnl
                                    ));
                                }
                            });
                        }
                    }
                }
```

**Step 4: Verify it compiles**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo check 2>&1`
Expected: compiles with no errors

**Step 5: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat(sim): add fill detection in WebSocket processing loop"
```

---

### Task 5: Render blue header and populate positions/trades in sim mode

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:73-139` (draw_header)
- Modify: `kalshi-arb/src/tui/render.rs:255-298` (draw_positions)
- Modify: `kalshi-arb/src/tui/render.rs:300-325` (draw_trades)

**Step 1: Update draw_header for sim mode**

Replace the `draw_header` function (lines 73-139) with:

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

    let (bal_cents, exp_cents, pnl_cents) = if state.sim_mode {
        let exposure: i64 = state.sim_positions.iter()
            .map(|p| (p.entry_price * p.quantity) as i64)
            .sum();
        (state.sim_balance_cents, exposure, state.sim_realized_pnl_cents)
    } else {
        (state.balance_cents, state.total_exposure_cents, state.realized_pnl_cents)
    };

    let bal = format!("${:.2}", bal_cents as f64 / 100.0);
    let exp = format!("${:.2}", exp_cents as f64 / 100.0);
    let pnl_val = format!("${:.2}", pnl_cents as f64 / 100.0);
    let uptime = state.uptime();

    let num_color = if state.sim_mode {
        Color::Blue
    } else if pnl_cents >= 0 {
        Color::Green
    } else {
        Color::Red
    };

    let pnl_span = Span::styled(pnl_val.clone(), Style::default().fg(num_color));

    let row1_width = 1 + 5 + bal.len() + 3 + 5 + exp.len() + 3 + 5 + pnl_val.len();
    let inner_width = area.width.saturating_sub(2) as usize;
    let needs_wrap = row1_width + 3 + 4 + 4 + 3 + 4 + uptime.len() + 8 > inner_width;

    let bal_exp_prefix = if state.sim_mode {
        vec![
            Span::styled(" Bal: ", Style::default().fg(Color::Blue)),
            Span::styled(&bal, Style::default().fg(Color::Blue)),
            Span::styled(" | Exp: ", Style::default().fg(Color::Blue)),
            Span::styled(&exp, Style::default().fg(Color::Blue)),
            Span::styled(" | P&L: ", Style::default().fg(Color::Blue)),
        ]
    } else {
        vec![Span::raw(format!(" Bal: {} | Exp: {} | P&L: ", bal, exp))]
    };

    let lines = if needs_wrap {
        vec![
            Line::from([bal_exp_prefix, vec![pnl_span]].concat()),
            Line::from(vec![
                Span::raw(" WS: "),
                kalshi_status,
                Span::raw(format!(" | Up: {}", uptime)),
                activity_indicator,
            ]),
        ]
    } else {
        vec![Line::from(
            [
                bal_exp_prefix,
                vec![
                    pnl_span,
                    Span::raw(" | WS: "),
                    kalshi_status,
                    Span::raw(format!(" | Up: {}", uptime)),
                    activity_indicator,
                ],
            ]
            .concat(),
        )]
    };

    let title = if state.sim_mode {
        " Kalshi Arb Engine [SIMULATION] "
    } else {
        " Kalshi Arb Engine "
    };

    let title_style = if state.sim_mode {
        Style::default().fg(Color::Blue).add_modifier(Modifier::BOLD)
    } else {
        Style::default()
    };

    let block = Block::default()
        .title(Span::styled(title, title_style))
        .borders(Borders::ALL);
    let para = Paragraph::new(lines).block(block);
    f.render_widget(para, area);
}
```

**Step 2: Update draw_positions to show sim positions**

In the `draw_positions` function (lines 255-298), replace the `let rows: Vec<Row> = state.positions` block (lines 263-278) with:

```rust
    let positions_source: Vec<PositionRow> = if state.sim_mode {
        state.sim_positions.iter().map(|sp| {
            // Unrealized P&L: what we'd get selling at entry_price (worst case, no market data here)
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
```

**Step 3: Add PositionRow import to render.rs**

Update the import at the top of render.rs (line 3):

```rust
use super::state::{AppState, PositionRow};
```

**Step 4: Verify it compiles**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo check 2>&1`
Expected: compiles with no errors

**Step 5: Run existing tests**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo test 2>&1`
Expected: all existing tests pass

**Step 6: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(sim): blue header, [SIMULATION] label, and sim position display"
```

---

### Task 6: Final verification

**Step 1: Full build**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo build 2>&1`
Expected: compiles successfully

**Step 2: Run all tests**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo test 2>&1`
Expected: all tests pass

**Step 3: Check for warnings**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo clippy 2>&1`
Expected: no errors (warnings acceptable)
