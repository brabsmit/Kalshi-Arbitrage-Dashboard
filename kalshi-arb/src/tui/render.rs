use std::borrow::Cow;

use super::state::{AppState, PositionRow};
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
                Constraint::Length(1),
            ])
            .split(f.area());

        draw_header(f, state, chunks[0], spinner_frame);
        draw_markets(f, state, chunks[1]);
        draw_positions(f, state, chunks[2]);
        draw_trades(f, state, chunks[3]);
        draw_logs(f, state, chunks[4]);
        draw_api_status(f, state, chunks[5]);
        draw_footer(f, state, chunks[6]);
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

fn draw_markets(f: &mut Frame, state: &AppState, area: Rect) {
    let inner_width = area.width.saturating_sub(2) as usize;
    let fixed_cols_full: usize = 5 + 5 + 5 + 6 + 8 + 8; // fair+bid+ask+edge+action+latency = 37

    let (headers, constraints, ticker_w, drop_latency, drop_action) = if inner_width < 45 {
        // Drop both Latency and Action
        let fixed = 5 + 5 + 5 + 6 + 5; // fair+bid+ask+edge+mom
        let ticker_w = inner_width.saturating_sub(fixed).max(4);
        (
            vec!["Ticker", "Fair", "Bid", "Ask", "Edge", "Mom"],
            vec![
                Constraint::Length(ticker_w as u16),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(6),
                Constraint::Length(5),
            ],
            ticker_w, true, true,
        )
    } else if inner_width < 55 {
        // Drop Latency only
        let fixed = 5 + 5 + 5 + 6 + 5 + 8; // fair+bid+ask+edge+mom+action
        let ticker_w = inner_width.saturating_sub(fixed).max(4);
        (
            vec!["Ticker", "Fair", "Bid", "Ask", "Edge", "Mom", "Action"],
            vec![
                Constraint::Length(ticker_w as u16),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(6),
                Constraint::Length(5),
                Constraint::Length(8),
            ],
            ticker_w, true, false,
        )
    } else {
        let fixed_with_mom = fixed_cols_full + 5; // +mom column
        let ticker_w = inner_width.saturating_sub(fixed_with_mom).max(4);
        (
            vec!["Ticker", "Fair", "Bid", "Ask", "Edge", "Mom", "Action", "Latency"],
            vec![
                Constraint::Length(ticker_w as u16),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(6),
                Constraint::Length(5),
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
            let mom_color = if m.momentum_score >= 75.0 {
                Color::Green
            } else if m.momentum_score >= 40.0 {
                Color::Yellow
            } else {
                Color::DarkGray
            };
            let mut cells = vec![
                Cell::from(ticker.into_owned()),
                Cell::from(m.fair_value.to_string()),
                Cell::from(m.bid.to_string()),
                Cell::from(m.ask.to_string()),
                Cell::from(format!("{:+}", m.edge))
                    .style(Style::default().fg(edge_color)),
                Cell::from(format!("{:.0}", m.momentum_score))
                    .style(Style::default().fg(mom_color)),
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
}

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

fn draw_trades(f: &mut Frame, state: &AppState, area: Rect) {
    let max_width = area.width.saturating_sub(2) as usize;
    let visible_lines = area.height.saturating_sub(2) as usize;

    let total = state.trades.len();

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
        .take(if state.trade_focus { visible_lines } else { 4 })
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

fn draw_api_status(f: &mut Frame, state: &AppState, area: Rect) {
    let quota_str = format!(
        " API: {}/{} used | {:.1} req/hr | ~{:.1}h left",
        state.api_requests_used,
        state.api_requests_used + state.api_requests_remaining,
        state.api_burn_rate,
        state.api_hours_remaining,
    );

    let color = if state.api_requests_remaining < 100 {
        Color::Red
    } else if state.api_requests_remaining < 250 {
        Color::Yellow
    } else {
        Color::DarkGray
    };

    let line = Line::from(Span::styled(quota_str, Style::default().fg(color)));
    let para = Paragraph::new(line);
    f.render_widget(para, area);
}

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
