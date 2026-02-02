use std::borrow::Cow;

use super::config_view;
use super::state::AppState;
use crate::engine::fees::calculate_fee;
use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Cell, Paragraph, Row, Table, Tabs},
    Frame,
};

const SPINNER_FRAMES: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

pub fn draw(f: &mut Frame, state: &AppState, spinner_frame: u8) {
    if state.config_focus {
        render_config(f, state);
        return;
    }

    let width = f.area().width.saturating_sub(2) as usize;

    let bal = format!("${:.2}", state.balance_cents as f64 / 100.0);
    let exp = format!("${:.2}", state.total_exposure_cents as f64 / 100.0);
    let pnl_val = format!("${:.2}", state.realized_pnl_cents as f64 / 100.0);
    let uptime = state.uptime();
    let row1_width = 1 + 5 + bal.len() + 3 + 5 + exp.len() + 3 + 5 + pnl_val.len();
    let full_width = row1_width + 3 + 4 + 4 + 3 + 4 + uptime.len() + 8;
    let header_height = if full_width > width { 4 } else { 3 };

    if state.diagnostic_focus {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Min(0),
                Constraint::Length(1),
                Constraint::Length(1),
            ])
            .split(f.area());

        draw_diagnostic_header(f, state, chunks[0]);
        draw_diagnostic(f, state, chunks[1]);
        draw_diagnostic_footer(f, chunks[2]);
        draw_sport_legend(f, state, chunks[3]);
    } else if state.log_focus {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(header_height),
                Constraint::Min(0),
                Constraint::Length(1),
                Constraint::Length(1),
            ])
            .split(f.area());

        draw_header(f, state, chunks[0], spinner_frame);
        draw_logs(f, state, chunks[1]);
        draw_footer(f, state, chunks[2]);
        draw_sport_legend(f, state, chunks[3]);
    } else if state.market_focus {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(header_height),
                Constraint::Min(0),
                Constraint::Length(1),
                Constraint::Length(1),
            ])
            .split(f.area());

        draw_header(f, state, chunks[0], spinner_frame);
        draw_markets(f, state, chunks[1]);
        draw_footer(f, state, chunks[2]);
        draw_sport_legend(f, state, chunks[3]);
    } else if state.position_focus {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(header_height),
                Constraint::Min(0),
                Constraint::Length(1),
                Constraint::Length(1),
            ])
            .split(f.area());

        draw_header(f, state, chunks[0], spinner_frame);
        draw_positions(f, state, chunks[1]);
        draw_footer(f, state, chunks[2]);
        draw_sport_legend(f, state, chunks[3]);
    } else if state.trade_focus {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(header_height),
                Constraint::Min(0),
                Constraint::Length(1),
                Constraint::Length(1),
            ])
            .split(f.area());

        draw_header(f, state, chunks[0], spinner_frame);
        draw_trades(f, state, chunks[1]);
        draw_footer(f, state, chunks[2]);
        draw_sport_legend(f, state, chunks[3]);
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
        draw_sport_legend(f, state, chunks[7]);
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
        Color::Cyan
    } else if pnl_cents >= 0 {
        Color::Green
    } else {
        Color::Red
    };

    let pnl_span = Span::styled(pnl_val.clone(), Style::default().fg(num_color));

    // Build sim stats spans (only shown in sim mode)
    let sim_stats_spans: Vec<Span> = if state.sim_mode {
        if state.sim_total_trades == 0 {
            vec![
                Span::styled(" | Trades: ", Style::default().fg(Color::DarkGray)),
                Span::styled("0", Style::default().fg(Color::DarkGray)),
            ]
        } else {
            let win_pct = state.sim_winning_trades * 100 / state.sim_total_trades;
            let avg_slip = state.sim_total_slippage_cents as f64 / state.sim_total_trades as f64;

            let win_color = if win_pct > 55 {
                Color::Green
            } else if win_pct >= 50 {
                Color::Yellow
            } else {
                Color::Red
            };

            let slip_color = if avg_slip <= 0.0 {
                Color::Green
            } else {
                Color::Yellow
            };

            vec![
                Span::styled(" | Trades: ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    format!("{}", state.sim_total_trades),
                    Style::default().fg(Color::Cyan),
                ),
                Span::styled(" | Win: ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    format!("{}%", win_pct),
                    Style::default().fg(win_color),
                ),
                Span::styled(" | Avg Slip: ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    format!("{:+.1}\u{00a2}", avg_slip),
                    Style::default().fg(slip_color),
                ),
            ]
        }
    } else {
        vec![]
    };

    let row1_width = 1 + 5 + bal.len() + 3 + 5 + exp.len() + 3 + 5 + pnl_val.len();
    let inner_width = area.width.saturating_sub(2) as usize;
    let needs_wrap = row1_width + 3 + 4 + 4 + 3 + 4 + uptime.len() + 8 > inner_width;

    let bal_exp_prefix = if state.sim_mode {
        vec![
            Span::styled(" Bal: ", Style::default().fg(Color::Cyan)),
            Span::styled(&bal, Style::default().fg(Color::Cyan)),
            Span::styled(" | Exp: ", Style::default().fg(Color::Cyan)),
            Span::styled(&exp, Style::default().fg(Color::Cyan)),
            Span::styled(" | P&L: ", Style::default().fg(Color::Cyan)),
        ]
    } else {
        vec![Span::raw(format!(" Bal: {} | Exp: {} | P&L: ", bal, exp))]
    };

    let lines = if needs_wrap {
        vec![
            Line::from([bal_exp_prefix, vec![pnl_span], sim_stats_spans].concat()),
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
                vec![pnl_span],
                sim_stats_spans,
                vec![
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
        format!(" Kalshi Arb Engine [SIMULATION] [{}] ", state.odds_source)
    } else {
        format!(" Kalshi Arb Engine [{}] ", state.odds_source)
    };

    let title_style = if state.sim_mode {
        Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)
    } else {
        Style::default()
    };

    let block = Block::default()
        .title(Span::styled(&title, title_style))
        .borders(Borders::ALL);
    let para = Paragraph::new(lines).block(block);
    f.render_widget(para, area);
}

fn draw_markets(f: &mut Frame, state: &AppState, area: Rect) {
    let inner_width = area.width.saturating_sub(2) as usize;

    // If no live markets, show filter summary + countdown
    if state.markets.is_empty() {
        let mut lines = vec![
            Line::from(""),
            Line::from(Span::styled(
                "No live markets",
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            )),
            Line::from(Span::styled(
                format!(
                    "{} pre-game \u{00b7} {} closed",
                    state.filter_stats.pre_game, state.filter_stats.closed
                ),
                Style::default().fg(Color::DarkGray),
            )),
            Line::from(""),
        ];

        if let Some(next_start) = state.next_game_start {
            let now = chrono::Utc::now();
            if next_start > now {
                let diff = next_start - now;
                let total_secs = diff.num_seconds().max(0) as u64;
                let h = total_secs / 3600;
                let m = (total_secs % 3600) / 60;
                let s = total_secs % 60;
                lines.push(Line::from(Span::styled(
                    format!("Next game starts in {}h {:02}m {:02}s", h, m, s),
                    Style::default().fg(Color::Cyan),
                )));
            } else {
                lines.push(Line::from(Span::styled(
                    "Next game starting...",
                    Style::default().fg(Color::Green),
                )));
            }
        } else {
            lines.push(Line::from(Span::styled(
                "No upcoming games found",
                Style::default().fg(Color::DarkGray),
            )));
        }

        let block = Block::default()
            .title(" Live Markets ")
            .borders(Borders::ALL);
        let para = Paragraph::new(lines)
            .alignment(Alignment::Center)
            .block(block);
        f.render_widget(para, area);
        return;
    }

    let fixed_cols_full: usize = 5 + 5 + 5 + 6 + 8 + 8; // fair+bid+ask+edge+action+latency = 37

    let (headers, constraints, ticker_w, drop_latency, drop_action, drop_stale) = if inner_width < 45 {
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
            ticker_w, true, true, true,
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
            ticker_w, true, false, true,
        )
    } else {
        let fixed_with_mom = fixed_cols_full + 5 + 7; // +mom +stale columns
        let ticker_w = inner_width.saturating_sub(fixed_with_mom).max(4);
        (
            vec!["Ticker", "Fair", "Bid", "Ask", "Edge", "Mom", "Stale", "Action", "Latency"],
            vec![
                Constraint::Length(ticker_w as u16),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(5),
                Constraint::Length(6),
                Constraint::Length(5),
                Constraint::Length(7),
                Constraint::Length(8),
                Constraint::Length(8),
            ],
            ticker_w, false, false, false,
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
            if !drop_stale {
                let stale_text = m.staleness_secs
                    .map(|s| format!("{}s", s))
                    .unwrap_or_else(|| "\u{2014}".to_string());
                let stale_color = match m.staleness_secs {
                    Some(s) if s < 30 => Color::Green,
                    Some(s) if s < 60 => Color::Yellow,
                    Some(_) => Color::Red,
                    None => Color::DarkGray,
                };
                cells.push(
                    Cell::from(stale_text).style(Style::default().fg(stale_color)),
                );
            }
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

fn draw_positions(f: &mut Frame, state: &AppState, area: Rect) {
    let inner_width = area.width.saturating_sub(2) as usize;

    // Responsive column dropping.
    // Fixed column widths: Side=4 Qty=5 Entry=6 Bid=5 Sell=6 Edge=6 Tgt=7 Mkt=7 Age=6 Src=6 = 58
    // Drop order: Src(6), Edge(6), Side(4), Age(6), Mkt(7)
    let show_src = inner_width >= 62;
    let show_edge = inner_width >= 56;
    let show_side = inner_width >= 48;
    let show_age = inner_width >= 44;
    let show_mkt = inner_width >= 38;

    let fixed: usize = 5 + 6 + 5 + 6 + 7  // Qty + Entry + Bid + Sell@ + Tgt (always shown)
        + if show_mkt { 7 } else { 0 }
        + if show_age { 6 } else { 0 }
        + if show_side { 4 } else { 0 }
        + if show_edge { 6 } else { 0 }
        + if show_src { 6 } else { 0 };
    let ticker_w = inner_width.saturating_sub(fixed).max(4);

    // Build header
    let mut headers: Vec<&str> = vec!["Ticker"];
    if show_side { headers.push("Side"); }
    headers.extend_from_slice(&["Qty", "Entry", "Bid", "Sell @"]);
    if show_edge { headers.push("Edge"); }
    headers.push("Tgt");
    if show_mkt { headers.push("Mkt"); }
    if show_age { headers.push("Age"); }
    if show_src { headers.push("Src"); }

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
    if show_src { constraints.push(Constraint::Length(6)); }

    let now = std::time::Instant::now();

    // Build rows from sim_positions
    // TODO: use state.positions when real mode is implemented
    let positions = &state.sim_positions;

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

            if show_src {
                let src_text = sp.trace.as_ref().map(|t| {
                    match &t.fair_value_method {
                        crate::pipeline::FairValueMethod::ScoreFeed { .. } => "score",
                        crate::pipeline::FairValueMethod::OddsFeed { .. } => "odds",
                    }
                }).unwrap_or("\u{2014}");
                cells.push(
                    Cell::from(src_text.to_string())
                        .style(Style::default().fg(Color::DarkGray)),
                );
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

fn draw_trades(f: &mut Frame, state: &AppState, area: Rect) {
    let inner_width = area.width.saturating_sub(2) as usize;
    let visible_lines = area.height.saturating_sub(4) as usize; // borders + header + padding

    let total = state.trades.len();

    let offset = if state.trade_focus {
        state.trade_scroll_offset.min(total.saturating_sub(visible_lines))
    } else {
        0
    };

    // Fixed column widths: Time=8 Action=4 Price=6 Qty=4 Type=5 P&L=7 Slip=6 = 40
    // Optional: SRC=6
    let base_fixed: usize = 8 + 4 + 6 + 4 + 5 + 7 + 6; // 40
    let show_src = inner_width >= base_fixed + 6 + 8; // need room for SRC + reasonable ticker
    let fixed_cols = base_fixed + if show_src { 6 } else { 0 };
    let ticker_w = inner_width.saturating_sub(fixed_cols).max(4);

    let mut headers = vec!["Time", "Action", "Ticker", "Price", "Qty", "Type", "P&L", "Slip"];
    if show_src { headers.push("SRC"); }
    let header = Row::new(headers)
        .style(Style::default().add_modifier(Modifier::BOLD));

    let mut constraints = vec![
        Constraint::Length(8),
        Constraint::Length(4),
        Constraint::Length(ticker_w as u16),
        Constraint::Length(6),
        Constraint::Length(4),
        Constraint::Length(5),
        Constraint::Length(7),
        Constraint::Length(6),
    ];
    if show_src { constraints.push(Constraint::Length(6)); }

    let rows: Vec<Row> = state
        .trades
        .iter()
        .rev()
        .skip(offset)
        .take(if state.trade_focus { visible_lines } else { 4 })
        .map(|t| {
            let pnl_cell = match t.pnl {
                Some(p) if p > 0 => Cell::from(format!("{:+}c", p))
                    .style(Style::default().fg(Color::Green)),
                Some(p) if p < 0 => Cell::from(format!("{:+}c", p))
                    .style(Style::default().fg(Color::Red)),
                Some(_) => Cell::from("0c")
                    .style(Style::default().fg(Color::DarkGray)),
                None => Cell::from("\u{2014}")
                    .style(Style::default().fg(Color::DarkGray)),
            };

            let slip_cell = match t.slippage {
                Some(s) if s > 0 => Cell::from(format!("+{}", s))
                    .style(Style::default().fg(Color::Yellow)),
                Some(s) if s < 0 => Cell::from(format!("{}", s))
                    .style(Style::default().fg(Color::Green)),
                Some(_) => Cell::from("0")
                    .style(Style::default().fg(Color::DarkGray)),
                None => Cell::from("\u{2014}")
                    .style(Style::default().fg(Color::DarkGray)),
            };

            let ticker = truncate_with_ellipsis(&t.ticker, ticker_w);

            let mut cells = vec![
                Cell::from(t.time.clone()),
                Cell::from(t.action.clone()),
                Cell::from(ticker.into_owned()),
                Cell::from(format!("{}c", t.price)),
                Cell::from(t.quantity.to_string()),
                Cell::from(t.order_type.clone()),
                pnl_cell,
                slip_cell,
            ];
            if show_src {
                let src_text = if t.source.is_empty() {
                    "\u{2014}".to_string()
                } else {
                    truncate_with_ellipsis(&t.source, 6).into_owned()
                };
                cells.push(
                    Cell::from(src_text)
                        .style(Style::default().fg(Color::DarkGray)),
                );
            }
            Row::new(cells)
        })
        .collect();

    let shown = rows.len();

    let title = if state.trade_focus {
        format!(
            " Recent Trades [{}/{}] ",
            (offset + shown).min(total),
            total,
        )
    } else {
        " Recent Trades ".to_string()
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
    let hours_left = if state.api_hours_remaining.is_infinite() {
        "\u{221e}".to_string()
    } else {
        format!("{:.1}", state.api_hours_remaining)
    };
    let quota_str = format!(
        " API: {}/{} used | {:.1} req/hr | ~{}h left",
        state.api_requests_used,
        state.api_requests_used + state.api_requests_remaining,
        state.api_burn_rate,
        hours_left,
    );

    let filter_str = format!(
        " | {} live \u{00b7} {} pre-game \u{00b7} {} closed",
        state.filter_stats.live,
        state.filter_stats.pre_game,
        state.filter_stats.closed,
    );

    let color = if state.api_requests_remaining < 100 {
        Color::Red
    } else if state.api_requests_remaining < 250 {
        Color::Yellow
    } else {
        Color::DarkGray
    };

    let line = Line::from(vec![
        Span::styled(quota_str, Style::default().fg(color)),
        Span::styled(filter_str, Style::default().fg(Color::DarkGray)),
    ]);
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
            Span::styled("[d]", Style::default().fg(Color::Yellow)),
            Span::raw("iag  "),
            Span::styled("[c]", Style::default().fg(Color::Yellow)),
            Span::raw("onfig  "),
        ])
    };
    let para = Paragraph::new(line);
    f.render_widget(para, area);
}

fn draw_sport_legend(f: &mut Frame, state: &AppState, area: Rect) {
    let mut spans: Vec<Span> = vec![Span::raw("  ")];

    for (_key, label, hotkey, enabled) in &state.sport_toggles {
        let style = if *enabled {
            Style::default().fg(Color::Green)
        } else {
            Style::default().fg(Color::DarkGray)
        };

        spans.push(Span::styled(format!("[{}]", hotkey), Style::default().fg(Color::Yellow)));
        spans.push(Span::styled(label.as_str(), style));
        spans.push(Span::raw(" "));
    }

    let line = Line::from(spans);
    let para = Paragraph::new(line);
    f.render_widget(para, area);
}

fn draw_diagnostic_header(f: &mut Frame, state: &AppState, area: Rect) {
    let mode_tag = if state.diagnostic_snapshot {
        Span::styled(" (Snapshot)", Style::default().fg(Color::Yellow))
    } else {
        Span::styled(" (Live)", Style::default().fg(Color::Green))
    };

    let total = state.diagnostic_rows.len();
    let count_span = Span::styled(
        format!(" [{} games]", total),
        Style::default().fg(Color::DarkGray),
    );

    let title_line = Line::from(vec![
        Span::styled(
            " All Games from All Sources",
            Style::default().add_modifier(Modifier::BOLD),
        ),
        mode_tag,
        count_span,
    ]);

    let block = Block::default()
        .title(" Diagnostic View ")
        .borders(Borders::ALL);
    let para = Paragraph::new(title_line).block(block);
    f.render_widget(para, area);
}

fn draw_diagnostic(f: &mut Frame, state: &AppState, area: Rect) {
    let inner_width = area.width.saturating_sub(2) as usize;
    let visible_lines = area.height.saturating_sub(4) as usize;

    if state.diagnostic_rows.is_empty() {
        let lines = vec![
            Line::from(""),
            Line::from(Span::styled(
                "No games returned from The Odds API",
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "Fetching data...",
                Style::default().fg(Color::DarkGray),
            )),
        ];
        let block = Block::default().borders(Borders::ALL);
        let para = Paragraph::new(lines).alignment(Alignment::Center).block(block);
        f.render_widget(para, area);
        return;
    }

    // Group rows by sport, sorted alphabetically
    let mut by_sport: std::collections::BTreeMap<&str, Vec<&super::state::DiagnosticRow>> =
        std::collections::BTreeMap::new();
    for row in &state.diagnostic_rows {
        by_sport.entry(&row.sport).or_default().push(row);
    }

    // Sort each group by commence_time
    for rows in by_sport.values_mut() {
        rows.sort_by(|a, b| a.commence_time.cmp(&b.commence_time));
    }

    // Responsive column widths
    // Full columns: Matchup + Commence(14) + Status(10) + Ticker(16) + Market(8) + Reason(18) + Source(10)
    let show_source = inner_width >= 96; // Need enough width for source column
    let fixed_cols = 14 + 10 + 16 + 8 + 18 + if show_source { 10 } else { 0 };
    let matchup_w = inner_width.saturating_sub(fixed_cols).max(10);

    // Build display lines: sport headers + data rows
    let mut display_rows: Vec<Row> = Vec::new();
    for (sport, rows) in &by_sport {
        // Sport header row
        let header_text = format!("── {} ({}) ──", sport.to_uppercase(), rows.len());
        let mut header_cells = vec![
            Cell::from(header_text).style(
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Cell::from(""),
            Cell::from(""),
            Cell::from(""),
            Cell::from(""),
            Cell::from(""),
        ];
        if show_source {
            header_cells.push(Cell::from(""));
        }
        display_rows.push(Row::new(header_cells));

        for row in rows {
            let status_style = match row.game_status.as_str() {
                s if s.starts_with("Live") => Style::default().fg(Color::Green),
                s if s.starts_with("Upcoming") => Style::default().fg(Color::Yellow),
                _ => Style::default().fg(Color::DarkGray),
            };

            let market_style = match row.market_status.as_deref() {
                Some("Open") => Style::default().fg(Color::Green),
                Some("Closed") => Style::default().fg(Color::Red),
                _ => Style::default().fg(Color::DarkGray),
            };

            let reason_style = if row.reason.contains("tradeable") {
                Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)
            } else if row.reason.contains("No match") {
                Style::default().fg(Color::DarkGray)
            } else {
                Style::default().fg(Color::White)
            };

            let mut cells = vec![
                Cell::from(truncate_with_ellipsis(&row.matchup, matchup_w).into_owned()),
                Cell::from(row.commence_time.clone()),
                Cell::from(row.game_status.clone()).style(status_style),
                Cell::from(
                    row.kalshi_ticker
                        .as_deref()
                        .map(|t| truncate_with_ellipsis(t, 16).into_owned())
                        .unwrap_or_else(|| "\u{2014}".to_string()),
                ),
                Cell::from(
                    row.market_status.as_deref().unwrap_or("\u{2014}").to_string(),
                )
                .style(market_style),
                Cell::from(row.reason.clone()).style(reason_style),
            ];

            if show_source {
                cells.push(
                    Cell::from(row.source.clone())
                        .style(Style::default().fg(Color::Cyan)),
                );
            }

            display_rows.push(Row::new(cells));
        }
    }

    let total = display_rows.len();
    let offset = state
        .diagnostic_scroll_offset
        .min(total.saturating_sub(visible_lines));

    let visible_rows: Vec<Row> = display_rows
        .into_iter()
        .skip(offset)
        .take(visible_lines)
        .collect();
    let visible_count = visible_rows.len();

    let matchup_w = matchup_w as u16;

    let mut header_labels = vec!["Matchup", "Commence(ET)", "Status", "Kalshi Ticker", "Market", "Reason"];
    if show_source {
        header_labels.push("Source");
    }

    let table_header = Row::new(header_labels)
        .style(Style::default().add_modifier(Modifier::BOLD));

    let mut constraints = vec![
        Constraint::Length(matchup_w),
        Constraint::Length(14),
        Constraint::Length(10),
        Constraint::Length(16),
        Constraint::Length(8),
        Constraint::Length(18),
    ];
    if show_source {
        constraints.push(Constraint::Length(10));
    }

    let table = Table::new(visible_rows, constraints)
    .header(table_header)
    .block(
        Block::default()
            .title(format!(
                " [{}/{}] ",
                (offset + visible_count).min(total),
                total,
            ))
            .borders(Borders::ALL),
    );

    f.render_widget(table, area);
}

fn draw_diagnostic_footer(f: &mut Frame, area: Rect) {
    let line = Line::from(vec![
        Span::styled("  [d/Esc]", Style::default().fg(Color::Yellow)),
        Span::raw(" close  "),
        Span::styled("[j/k]", Style::default().fg(Color::Yellow)),
        Span::raw(" scroll  "),
        Span::styled("[g/G]", Style::default().fg(Color::Yellow)),
        Span::raw(" top/bottom  "),
    ]);
    let para = Paragraph::new(line);
    f.render_widget(para, area);
}

fn truncate_with_ellipsis(s: &str, max_width: usize) -> Cow<'_, str> {
    let char_count = s.chars().count();
    if char_count <= max_width {
        Cow::Borrowed(s)
    } else if max_width <= 3 {
        Cow::Owned(".".repeat(max_width))
    } else {
        let end = s
            .char_indices()
            .nth(max_width - 3)
            .map(|(i, _)| i)
            .unwrap_or(s.len());
        Cow::Owned(format!("{}...", &s[..end]))
    }
}

fn render_config(f: &mut Frame, state: &AppState) {
    let Some(cv) = &state.config_view else { return };

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // tab bar
            Constraint::Min(0),   // body
            Constraint::Length(1), // help line
        ])
        .split(f.area());

    // Tab bar
    let tab_titles: Vec<Line> = cv
        .tabs
        .iter()
        .enumerate()
        .map(|(i, t)| {
            if i == cv.active_tab {
                Line::from(Span::styled(
                    t.label.as_str(),
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ))
            } else {
                Line::from(Span::raw(t.label.as_str()))
            }
        })
        .collect();
    let tabs = Tabs::new(tab_titles)
        .block(Block::default().borders(Borders::ALL).title(" Config "))
        .highlight_style(Style::default().fg(Color::Yellow))
        .select(cv.active_tab);
    f.render_widget(tabs, chunks[0]);

    // Body: field list
    let active_tab = &cv.tabs[cv.active_tab];
    let rows: Vec<Row> = active_tab
        .fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let label_style = if field.is_override {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default().fg(Color::White)
            };
            let value_str = if cv.editing && i == cv.selected_field {
                format!("{}\u{258f}", cv.edit_buffer) // show cursor
            } else if let config_view::FieldType::Enum(_) = &field.field_type {
                format!("\u{25c0} {} \u{25b6}", field.value)
            } else {
                field.value.clone()
            };
            let value_style = if field.read_only {
                Style::default().fg(Color::DarkGray)
            } else if i == cv.selected_field {
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            };
            Row::new(vec![
                Cell::from(field.label.clone()).style(label_style),
                Cell::from(value_str).style(value_style),
            ])
        })
        .collect();

    let table = Table::new(
        rows,
        [Constraint::Percentage(50), Constraint::Percentage(50)],
    )
    .block(
        Block::default()
            .borders(Borders::ALL)
            .title(format!(" {} ", active_tab.label)),
    )
    .row_highlight_style(Style::default().bg(Color::DarkGray));
    let mut table_state = ratatui::widgets::TableState::default();
    table_state.select(Some(cv.selected_field));
    f.render_stateful_widget(table, chunks[1], &mut table_state);

    // Help line
    let help = if cv.editing {
        " Enter: confirm | Esc: cancel | Type to edit "
    } else {
        " \u{2190}\u{2192}: tabs | \u{2191}\u{2193}: fields | Enter: edit | Space: toggle | d: delete override | Esc: close "
    };
    let help_line = Paragraph::new(help).style(Style::default().fg(Color::DarkGray));
    f.render_widget(help_line, chunks[2]);
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

    #[test]
    fn test_truncate_multibyte_chars() {
        // ¢ is 2 bytes in UTF-8; must not panic when truncation lands inside it
        let s = "price 1¢ ok";
        assert_eq!(truncate_with_ellipsis(s, 9), "price ...");
        // The exact crash string from production
        let prod = "SIM BUY 10x KXNCAAMBGAME-26JAN31UNCGT-GT @ 1¢ (ask was 1¢, slip +0¢), sell target 2¢";
        let result = truncate_with_ellipsis(prod, 72);
        assert!(result.ends_with("..."));
        assert!(result.chars().count() <= 72);
    }

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
}
