use super::state::AppState;
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Cell, Paragraph, Row, Table},
    Frame,
};

pub fn draw(f: &mut Frame, state: &AppState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),  // header
            Constraint::Min(8),    // markets
            Constraint::Length(6), // positions
            Constraint::Length(6), // trades
            Constraint::Min(5),   // logs
            Constraint::Length(1), // footer
        ])
        .split(f.area());

    draw_header(f, state, chunks[0]);
    draw_markets(f, state, chunks[1]);
    draw_positions(f, state, chunks[2]);
    draw_trades(f, state, chunks[3]);
    draw_logs(f, state, chunks[4]);
    draw_footer(f, state, chunks[5]);
}

fn draw_header(f: &mut Frame, state: &AppState, area: Rect) {
    let kalshi_status = if state.kalshi_ws_connected {
        Span::styled("CONNECTED", Style::default().fg(Color::Green))
    } else {
        Span::styled("DISCONNECTED", Style::default().fg(Color::Red))
    };

    let pause_status = if state.is_paused {
        Span::styled(" PAUSED", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))
    } else {
        Span::styled(" RUNNING", Style::default().fg(Color::Green))
    };

    let line = Line::from(vec![
        Span::raw(format!(
            " Balance: ${:.2}  |  Exposure: ${:.2}  |  P&L: ",
            state.balance_cents as f64 / 100.0,
            state.total_exposure_cents as f64 / 100.0,
        )),
        Span::styled(
            format!("${:.2}", state.realized_pnl_cents as f64 / 100.0),
            Style::default().fg(if state.realized_pnl_cents >= 0 {
                Color::Green
            } else {
                Color::Red
            }),
        ),
        Span::raw("  |  Kalshi: "),
        kalshi_status,
        Span::raw(format!("  |  Uptime: {}", state.uptime())),
        pause_status,
    ]);

    let block = Block::default()
        .title(" Kalshi Arb Engine ")
        .borders(Borders::ALL);
    let para = Paragraph::new(line).block(block);
    f.render_widget(para, area);
}

fn draw_markets(f: &mut Frame, state: &AppState, area: Rect) {
    let header = Row::new(vec!["Ticker", "Fair", "Bid", "Ask", "Edge", "Action", "Latency"])
        .style(Style::default().add_modifier(Modifier::BOLD));

    let rows: Vec<Row> = state
        .markets
        .iter()
        .map(|m| {
            let edge_color = if m.edge > 0 { Color::Green } else { Color::Red };
            Row::new(vec![
                Cell::from(m.ticker.clone()),
                Cell::from(m.fair_value.to_string()),
                Cell::from(m.bid.to_string()),
                Cell::from(m.ask.to_string()),
                Cell::from(format!("{:+}", m.edge))
                    .style(Style::default().fg(edge_color)),
                Cell::from(m.action.clone()),
                Cell::from(
                    m.latency_ms
                        .map(|l| format!("{}ms", l))
                        .unwrap_or_else(|| "--".to_string()),
                ),
            ])
        })
        .collect();

    let table = Table::new(
        rows,
        [
            Constraint::Percentage(25),
            Constraint::Length(5),
            Constraint::Length(5),
            Constraint::Length(5),
            Constraint::Length(6),
            Constraint::Length(8),
            Constraint::Length(8),
        ],
    )
    .header(header)
    .block(
        Block::default()
            .title(" Live Markets ")
            .borders(Borders::ALL),
    );

    f.render_widget(table, area);
}

fn draw_positions(f: &mut Frame, state: &AppState, area: Rect) {
    let header = Row::new(vec!["Ticker", "Qty", "Entry", "Sell @", "P&L"])
        .style(Style::default().add_modifier(Modifier::BOLD));

    let rows: Vec<Row> = state
        .positions
        .iter()
        .map(|p| {
            let pnl_color = if p.unrealized_pnl >= 0 { Color::Green } else { Color::Red };
            Row::new(vec![
                Cell::from(p.ticker.clone()),
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
            Constraint::Percentage(30),
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
