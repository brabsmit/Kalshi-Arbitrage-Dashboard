pub mod render;
pub mod state;

use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
    ExecutableCommand,
};
use ratatui::prelude::*;
use state::AppState;
use std::io::stdout;
use std::time::Duration;
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
    loop {
        let state = state_rx.borrow().clone();
        terminal.draw(|f| render::draw(f, &state))?;

        // Poll for keyboard events with 100ms timeout
        if event::poll(Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
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

        // Check if state has changed
        let _ = state_rx.changed().await;
    }
}
