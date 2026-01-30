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
}

/// Run the TUI. Reads state from `state_rx`, sends commands on `cmd_tx`.
pub async fn run_tui(
    state_rx: watch::Receiver<AppState>,
    cmd_tx: tokio::sync::mpsc::Sender<TuiCommand>,
) -> Result<()> {
    enable_raw_mode()?;
    stdout().execute(EnterAlternateScreen)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;

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

    loop {
        // Always render current state + spinner
        {
            let state = state_rx.borrow().clone();
            terminal.draw(|f| render::draw(f, &state, spinner_frame))?;
        }

        // Wait for whichever fires first: tick, keyboard, or state change
        tokio::select! {
            _ = ticker.tick() => {
                spinner_frame = spinner_frame.wrapping_add(1);
            }
            event = event_stream.next() => {
                if let Some(Ok(Event::Key(key))) = event {
                    if key.kind == KeyEventKind::Press {
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
                            _ => {}
                        }
                    }
                }
            }
            _ = state_rx.changed() => {
                // State updated — will re-render on next iteration
            }
        }
    }
}
