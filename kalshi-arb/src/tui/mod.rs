pub mod render;
pub mod state;

use anyhow::Result;
use crossterm::{
    event::{Event, EventStream, KeyCode, KeyEventKind},
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
    ExecutableCommand,
};
use futures_util::StreamExt;
use ratatui::prelude::*;
use state::AppState;
use std::io::stdout;
use tokio::sync::watch;

/// Commands the TUI can send back to the engine.
#[derive(Debug, Clone)]
pub enum TuiCommand {
    Quit,
    Pause,
    Resume,
    FetchDiagnostic,
    ToggleSport(String),
}

/// Run the TUI. Reads state from `state_rx`, sends commands on `cmd_tx`.
pub async fn run_tui(
    state_rx: watch::Receiver<AppState>,
    cmd_tx: tokio::sync::mpsc::Sender<TuiCommand>,
) -> Result<()> {
    enable_raw_mode()?;
    stdout().execute(EnterAlternateScreen)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    terminal.clear()?;

    let result = tui_loop(&mut terminal, state_rx, cmd_tx).await;

    disable_raw_mode()?;
    stdout().execute(LeaveAlternateScreen)?;

    result
}

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
    let mut market_focus = false;
    let mut market_scroll_offset: usize = 0;
    let mut position_focus = false;
    let mut position_scroll_offset: usize = 0;
    let mut trade_focus = false;
    let mut trade_scroll_offset: usize = 0;
    let mut diagnostic_focus = false;
    let mut diagnostic_scroll_offset: usize = 0;

    loop {
        // Render current state with UI-local overrides
        {
            let mut state = state_rx.borrow().clone();
            state.log_focus = log_focus;
            state.log_scroll_offset = log_scroll_offset;
            state.market_focus = market_focus;
            state.market_scroll_offset = market_scroll_offset;
            state.position_focus = position_focus;
            state.position_scroll_offset = position_scroll_offset;
            state.trade_focus = trade_focus;
            state.trade_scroll_offset = trade_scroll_offset;
            state.diagnostic_focus = diagnostic_focus;
            state.diagnostic_scroll_offset = diagnostic_scroll_offset;
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
                                KeyCode::Char(c @ '1'..='8') => {
                                    let key = state_rx.borrow().sport_toggles.iter()
                                        .find(|(_, _, h, _)| *h == c)
                                        .map(|(k, _, _, _)| k.clone());
                                    if let Some(k) = key {
                                        let _ = cmd_tx.send(TuiCommand::ToggleSport(k)).await;
                                    }
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
                                KeyCode::Char(c @ '1'..='8') => {
                                    let key = state_rx.borrow().sport_toggles.iter()
                                        .find(|(_, _, h, _)| *h == c)
                                        .map(|(k, _, _, _)| k.clone());
                                    if let Some(k) = key {
                                        let _ = cmd_tx.send(TuiCommand::ToggleSport(k)).await;
                                    }
                                }
                                _ => {}
                            }
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
                                    let state = state_rx.borrow();
                                    let total = if state.sim_mode {
                                        state.sim_positions.len()
                                    } else {
                                        state.positions.len()
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
                                KeyCode::Char(c @ '1'..='8') => {
                                    let key = state_rx.borrow().sport_toggles.iter()
                                        .find(|(_, _, h, _)| *h == c)
                                        .map(|(k, _, _, _)| k.clone());
                                    if let Some(k) = key {
                                        let _ = cmd_tx.send(TuiCommand::ToggleSport(k)).await;
                                    }
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
                                KeyCode::Char(c @ '1'..='8') => {
                                    let key = state_rx.borrow().sport_toggles.iter()
                                        .find(|(_, _, h, _)| *h == c)
                                        .map(|(k, _, _, _)| k.clone());
                                    if let Some(k) = key {
                                        let _ = cmd_tx.send(TuiCommand::ToggleSport(k)).await;
                                    }
                                }
                                _ => {}
                            }
                        } else if diagnostic_focus {
                            match key.code {
                                KeyCode::Esc | KeyCode::Char('d') => {
                                    diagnostic_focus = false;
                                    diagnostic_scroll_offset = 0;
                                }
                                KeyCode::Char('j') | KeyCode::Down => {
                                    diagnostic_scroll_offset = diagnostic_scroll_offset.saturating_add(1);
                                }
                                KeyCode::Char('k') | KeyCode::Up => {
                                    diagnostic_scroll_offset = diagnostic_scroll_offset.saturating_sub(1);
                                }
                                KeyCode::Char('G') => {
                                    let total = state_rx.borrow().diagnostic_rows.len();
                                    diagnostic_scroll_offset = total;
                                }
                                KeyCode::Char('g') => {
                                    diagnostic_scroll_offset = 0;
                                }
                                KeyCode::Char('q') => {
                                    let _ = cmd_tx.send(TuiCommand::Quit).await;
                                    return Ok(());
                                }
                                KeyCode::Char(c @ '1'..='8') => {
                                    let key = state_rx.borrow().sport_toggles.iter()
                                        .find(|(_, _, h, _)| *h == c)
                                        .map(|(k, _, _, _)| k.clone());
                                    if let Some(k) = key {
                                        let _ = cmd_tx.send(TuiCommand::ToggleSport(k)).await;
                                    }
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
                                KeyCode::Char('o') => {
                                    position_focus = true;
                                    position_scroll_offset = 0;
                                }
                                KeyCode::Char('t') => {
                                    trade_focus = true;
                                    trade_scroll_offset = 0;
                                }
                                KeyCode::Char('d') => {
                                    diagnostic_focus = true;
                                    diagnostic_scroll_offset = 0;
                                    // If no live games (engine idle), trigger one-shot fetch
                                    if state_rx.borrow().markets.is_empty() {
                                        let _ = cmd_tx.send(TuiCommand::FetchDiagnostic).await;
                                    }
                                }
                                KeyCode::Char(c @ '1'..='8') => {
                                    let key = state_rx.borrow().sport_toggles.iter()
                                        .find(|(_, _, h, _)| *h == c)
                                        .map(|(k, _, _, _)| k.clone());
                                    if let Some(k) = key {
                                        let _ = cmd_tx.send(TuiCommand::ToggleSport(k)).await;
                                    }
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
