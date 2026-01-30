use std::borrow::Cow;

use super::state::AppState;
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Cell, Paragraph, Row, Table},
    Frame,
};

const SPINNER_FRAMES: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

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
    let row1_width = 1 + 5 + bal.len() + 3 + 5 + exp.len() + 3 + 5 + pnl_val.len();
    let inner_width = area.width.saturating_sub(2) as usize;
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

fn draw_markets(f: &mut Frame, state: &AppState, area: Rect) {
    let inner_width = area.width.saturating_sub(2) as usize;
    let fixed_cols_full: usize = 5 + 5 + 5 + 6 + 8 + 8; // fair+bid+ask+edge+action+latency = 37

    let (headers, constraints, ticker_w, drop_latency, drop_action) = if inner_width < 45 {
        // Drop both Latency and Action
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
        // Drop Latency only
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

    let header = Row::new(headers)
        .style(Style::default().add_modifier(Modifier::BOLD));

    let rows: Vec<Row> = state
        .markets
        .iter()
        .map(|m| {
            let edge_color = if m.edge > 0 { Color::Green } else { Color::Red };
            let ticker = truncate_with_ellipsis(&m.ticker, ticker_w);
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

fn draw_trades(f: &mut Frame, state: &AppState, area: Rect) {
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
            Line::from(format!(
                " {} {} {}x {} @ {}c ({}){}",
                t.time, t.action, t.quantity, t.ticker, t.price, t.order_type, pnl
            ))
        })
        .collect();

    let block = Block::default()
        .title(" Recent Trades ")
        .borders(Borders::ALL);
    let para = Paragraph::new(lines).block(block);
    f.render_widget(para, area);
}

fn draw_logs(f: &mut Frame, state: &AppState, area: Rect) {
    let lines: Vec<Line> = state
        .logs
        .iter()
        .rev()
        .take(area.height.saturating_sub(2) as usize)
        .map(|l| {
            let color = match l.level.as_str() {
                "ERROR" => Color::Red,
                "WARN" => Color::Yellow,
                "TRADE" => Color::Cyan,
                _ => Color::DarkGray,
            };
            Line::from(vec![
                Span::styled(
                    format!(" {} [{}] ", l.time, l.level),
                    Style::default().fg(color),
                ),
                Span::raw(&l.message),
            ])
        })
        .collect();

    let block = Block::default()
        .title(" Engine Log ")
        .borders(Borders::ALL);
    let para = Paragraph::new(lines).block(block);
    f.render_widget(para, area);
}

fn draw_footer(f: &mut Frame, _state: &AppState, area: Rect) {
    let line = Line::from(vec![
        Span::styled("  [q]", Style::default().fg(Color::Yellow)),
        Span::raw("uit  "),
        Span::styled("[p]", Style::default().fg(Color::Yellow)),
        Span::raw("ause  "),
        Span::styled("[r]", Style::default().fg(Color::Yellow)),
        Span::raw("esume  "),
    ]);
    let para = Paragraph::new(line);
    f.render_widget(para, area);
}

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
