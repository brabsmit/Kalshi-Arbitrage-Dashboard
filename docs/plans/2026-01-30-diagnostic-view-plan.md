# Diagnostic View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a full-screen diagnostic view (toggled with `d`) that shows all games from the-odds-api with their Kalshi matching status, answering "why are there no live markets?"

**Architecture:** New `DiagnosticRow` struct in state, new `FetchDiagnostic` TUI command for one-shot fetches when engine is idle, new `draw_diagnostic` render function. Data flows from the engine's existing odds polling (live-updating) or a one-shot fetch (snapshot mode). The diagnostic view follows the same focus-panel pattern as logs/markets/positions/trades.

**Tech Stack:** Rust, ratatui, crossterm, tokio channels, chrono

---

### Task 1: Add DiagnosticRow struct and AppState fields

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs:1-46` (add struct + fields)

**Step 1: Add the DiagnosticRow struct after FilterStats**

Add after line 11 (closing brace of FilterStats):

```rust
#[derive(Debug, Clone)]
pub struct DiagnosticRow {
    pub sport: String,
    pub matchup: String,
    pub commence_time: String,
    pub game_status: String,
    pub kalshi_ticker: Option<String>,
    pub market_status: Option<String>,
    pub reason: String,
}
```

**Step 2: Add fields to AppState**

Add after `next_game_start` field (line 45):

```rust
    pub diagnostic_rows: Vec<DiagnosticRow>,
    pub diagnostic_snapshot: bool,
    pub diagnostic_focus: bool,
    pub diagnostic_scroll_offset: usize,
```

**Step 3: Initialize new fields in AppState::new()**

Add after `next_game_start: None,` (line 129):

```rust
            diagnostic_rows: Vec::new(),
            diagnostic_snapshot: false,
            diagnostic_focus: false,
            diagnostic_scroll_offset: 0,
```

**Step 4: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: compiles with no errors (warnings OK)

**Step 5: Commit**

```bash
git add kalshi-arb/src/tui/state.rs
git commit -m "feat(diagnostic): add DiagnosticRow struct and AppState fields"
```

---

### Task 2: Add FetchDiagnostic TUI command

**Files:**
- Modify: `kalshi-arb/src/tui/mod.rs:18-22` (add enum variant)

**Step 1: Add FetchDiagnostic to TuiCommand enum**

In `kalshi-arb/src/tui/mod.rs`, add `FetchDiagnostic` to the `TuiCommand` enum at line 21:

```rust
#[derive(Debug, Clone)]
pub enum TuiCommand {
    Quit,
    Pause,
    Resume,
    FetchDiagnostic,
}
```

**Step 2: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: compiles (may warn about non-exhaustive match, but the engine's `match cmd` uses specific variants not a wildcard, so this will be a compile error — fix in Task 5)

Actually, looking at `main.rs:266-278` and `main.rs:753-764`, the engine uses specific match arms, not a wildcard. Adding a new variant will cause a non-exhaustive match error. We need to handle it in the engine at the same time. Add a placeholder arm for now:

**Step 2b: Add placeholder match arms in main.rs**

In `main.rs`, there are two `match cmd` blocks. Add `TuiCommand::FetchDiagnostic => {}` to both:

At line 276 (first match block, after `Quit => return,`):
```rust
                    tui::TuiCommand::FetchDiagnostic => {}
```

At line 763 (second match block inside the sleep-select, after `Quit => return,`):
```rust
                            tui::TuiCommand::FetchDiagnostic => {}
                        }
```

**Step 3: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: compiles with no errors

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/mod.rs kalshi-arb/src/main.rs
git commit -m "feat(diagnostic): add FetchDiagnostic TUI command variant"
```

---

### Task 3: Add keyboard handling for diagnostic view

**Files:**
- Modify: `kalshi-arb/src/tui/mod.rs:42-223` (add focus state + key handling)

**Step 1: Add diagnostic focus state variables**

In `tui_loop()`, after the existing focus variables (line 56-57), add:

```rust
    let mut diagnostic_focus = false;
    let mut diagnostic_scroll_offset: usize = 0;
```

**Step 2: Wire diagnostic focus into state before rendering**

In the render block (lines 61-72), add after `state.trade_scroll_offset = trade_scroll_offset;` (line 69):

```rust
            state.diagnostic_focus = diagnostic_focus;
            state.diagnostic_scroll_offset = diagnostic_scroll_offset;
```

**Step 3: Add diagnostic focus key handling**

In the keyboard handling section, add a new `else if diagnostic_focus` block. Insert it after the `trade_focus` block (after line 185, before the `else` global handler):

```rust
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
                                _ => {}
                            }
```

**Step 4: Add `d` key to global handler**

In the global `else` block (around line 186-215), add a new arm after the `'t'` handler:

```rust
                                KeyCode::Char('d') => {
                                    diagnostic_focus = true;
                                    diagnostic_scroll_offset = 0;
                                    // If no live games (engine idle), trigger one-shot fetch
                                    if state_rx.borrow().markets.is_empty() {
                                        let _ = cmd_tx.send(TuiCommand::FetchDiagnostic).await;
                                    }
                                }
```

**Step 5: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: compiles with no errors

**Step 6: Commit**

```bash
git add kalshi-arb/src/tui/mod.rs
git commit -m "feat(diagnostic): add keyboard handling for diagnostic view"
```

---

### Task 4: Add draw_diagnostic render function

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs` (add rendering + integrate into draw())

**Step 1: Add diagnostic_focus to the draw() routing**

In `draw()` (line 14-99), add a new branch for `state.diagnostic_focus` BEFORE the existing `state.log_focus` check (line 25). This ensures diagnostic takes priority since it's a full overlay:

```rust
    if state.diagnostic_focus {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Min(0),
                Constraint::Length(1),
            ])
            .split(f.area());

        draw_diagnostic_header(f, state, chunks[0]);
        draw_diagnostic(f, state, chunks[1]);
        draw_diagnostic_footer(f, chunks[2]);
    } else if state.log_focus {
```

**Step 2: Add draw_diagnostic_header function**

Add after `draw_footer()` (before `truncate_with_ellipsis`):

```rust
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
            " All Games from The Odds API",
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
```

**Step 3: Add draw_diagnostic function**

```rust
fn draw_diagnostic(f: &mut Frame, state: &AppState, area: Rect) {
    let inner_width = area.width.saturating_sub(2) as usize;
    let visible_lines = area.height.saturating_sub(2) as usize;

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

    // Build display lines: sport headers + data rows
    let mut display_rows: Vec<Row> = Vec::new();
    for (sport, rows) in &by_sport {
        // Sport header row
        let header_text = format!("── {} ({}) ──", sport.to_uppercase(), rows.len());
        display_rows.push(
            Row::new(vec![
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
            ])
        );

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

            let matchup_w = inner_width.saturating_sub(14 + 10 + 16 + 8 + 18).max(10);

            display_rows.push(Row::new(vec![
                Cell::from(truncate_with_ellipsis(&row.matchup, matchup_w).into_owned()),
                Cell::from(row.commence_time.clone()),
                Cell::from(row.game_status.clone()).style(status_style),
                Cell::from(
                    row.kalshi_ticker
                        .as_deref()
                        .map(|t| truncate_with_ellipsis(t, 16).into_owned())
                        .unwrap_or_else(|| "—".to_string()),
                ),
                Cell::from(
                    row.market_status.as_deref().unwrap_or("—").to_string(),
                )
                .style(market_style),
                Cell::from(row.reason.clone()).style(reason_style),
            ]));
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

    // Responsive column widths
    let matchup_w = inner_width.saturating_sub(14 + 10 + 16 + 8 + 18).max(10) as u16;

    let table_header = Row::new(vec!["Matchup", "Commence(ET)", "Status", "Kalshi Ticker", "Market", "Reason"])
        .style(Style::default().add_modifier(Modifier::BOLD));

    let table = Table::new(
        visible_rows,
        [
            Constraint::Length(matchup_w),
            Constraint::Length(14),
            Constraint::Length(10),
            Constraint::Length(16),
            Constraint::Length(8),
            Constraint::Length(18),
        ],
    )
    .header(table_header)
    .block(
        Block::default()
            .title(format!(
                " [{}/{}] ",
                (offset + visible_lines).min(total),
                total,
            ))
            .borders(Borders::ALL),
    );

    f.render_widget(table, area);
}
```

**Step 4: Add draw_diagnostic_footer function**

```rust
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
```

**Step 5: Update draw_footer to show `d` key hint in global mode**

In `draw_footer()`, add `[d]iagnostic` to the global mode footer hints. After the `[t]rades` span (around line 622):

```rust
            Span::styled("[d]", Style::default().fg(Color::Yellow)),
            Span::raw("iag  "),
```

**Step 6: Also update draw_footer's focused-panel check**

In `draw_footer()` line 598, the condition checks if any focus is active. Add `diagnostic_focus`:

```rust
    let line = if state.log_focus || state.market_focus || state.position_focus || state.trade_focus || state.diagnostic_focus {
```

Wait — `diagnostic_focus` already routes to `draw_diagnostic_footer` instead of `draw_footer`, so this isn't needed. The `draw()` function routes to `draw_diagnostic_footer` when diagnostic is focused. Skip this step.

**Step 7: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: compiles with no errors

**Step 8: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(diagnostic): add diagnostic view rendering"
```

---

### Task 5: Build DiagnosticRow list in the engine (live-updating path)

**Files:**
- Modify: `kalshi-arb/src/main.rs` (build diagnostic rows during polling cycle)

This task adds a helper function `build_diagnostic_rows` and calls it during the normal polling cycle to populate `AppState.diagnostic_rows`.

**Step 1: Add a helper function to build diagnostic rows from OddsUpdate + MarketIndex**

Add this function before `main()` in `kalshi-arb/src/main.rs`:

```rust
/// Build diagnostic rows from all odds updates for a given sport.
fn build_diagnostic_rows(
    updates: &[feed::types::OddsUpdate],
    sport: &str,
    market_index: &matcher::MarketIndex,
) -> Vec<tui::state::DiagnosticRow> {
    let eastern = chrono::FixedOffset::west_opt(5 * 3600).unwrap();
    let now_utc = chrono::Utc::now();

    updates
        .iter()
        .map(|update| {
            let matchup = format!("{} vs {}", update.away_team, update.home_team);

            // Format commence time in ET
            let commence_et = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
                .ok()
                .map(|dt| dt.with_timezone(&eastern).format("%b %d %H:%M").to_string())
                .unwrap_or_else(|| update.commence_time.clone());

            // Determine game status
            let commence_dt = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
                .ok()
                .map(|dt| dt.with_timezone(&chrono::Utc));

            let game_status = match commence_dt {
                Some(ct) if ct <= now_utc => "Live".to_string(),
                Some(ct) => {
                    let diff = ct - now_utc;
                    let total_secs = diff.num_seconds().max(0) as u64;
                    let h = total_secs / 3600;
                    let m = (total_secs % 3600) / 60;
                    if h > 0 {
                        format!("Upcoming ({}h {:02}m)", h, m)
                    } else {
                        format!("Upcoming ({}m)", m)
                    }
                }
                None => "Unknown".to_string(),
            };

            // Try to match to Kalshi
            let date = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
                .ok()
                .map(|dt| dt.with_timezone(&eastern).date_naive());

            let (lookup_home, lookup_away) = if sport == "mma" {
                (last_name(&update.home_team).to_string(), last_name(&update.away_team).to_string())
            } else {
                (update.home_team.clone(), update.away_team.clone())
            };

            let matched_game = date.and_then(|d| {
                matcher::generate_key(sport, &lookup_home, &lookup_away, d)
                    .and_then(|k| market_index.get(&k))
            });

            let (kalshi_ticker, market_status, reason) = match matched_game {
                Some(game) => {
                    // Pick the first available side market for display
                    let side = game.home.as_ref()
                        .or(game.away.as_ref())
                        .or(game.draw.as_ref());

                    match side {
                        Some(sm) => {
                            let is_open = sm.status == "open"
                                && sm.close_time.as_deref()
                                    .and_then(|ct| chrono::DateTime::parse_from_rfc3339(ct).ok())
                                    .is_none_or(|ct| ct.with_timezone(&chrono::Utc) > now_utc);

                            let market_st = if is_open { "Open" } else { "Closed" };

                            let reason = match (&game_status, is_open) {
                                (s, true) if s.starts_with("Live") => "Live & tradeable".to_string(),
                                (s, false) if s.starts_with("Live") => "Market closed".to_string(),
                                (s, _) if s.starts_with("Upcoming") => "Not started yet".to_string(),
                                _ => "Game ended".to_string(),
                            };

                            (Some(sm.ticker.clone()), Some(market_st.to_string()), reason)
                        }
                        None => (None, None, "No match found".to_string()),
                    }
                }
                None => (None, None, "No match found".to_string()),
            };

            tui::state::DiagnosticRow {
                sport: sport.to_string(),
                matchup,
                commence_time: commence_et,
                game_status,
                kalshi_ticker,
                market_status,
                reason,
            }
        })
        .collect()
}
```

**Step 2: Accumulate diagnostic rows alongside market rows in the polling loop**

In the engine's polling loop (the spawned task starting ~line 237), add a `Vec<DiagnosticRow>` accumulator. After `accumulated_rows.clear();` (line 291), add:

```rust
            let mut diagnostic_rows_acc: Vec<tui::state::DiagnosticRow> = Vec::new();
```

Then, right after each successful `fetch_odds` call (inside the `Ok(updates)` arm at line 352), after updating API quota (line 379), add:

```rust
                        // Build diagnostic rows for this sport
                        diagnostic_rows_acc.extend(
                            build_diagnostic_rows(&updates, sport, &market_index)
                        );
```

**Step 3: Push diagnostic rows into AppState**

In the final state update at lines 793-802 (`state_tx_engine.send_modify`), add:

```rust
                state.diagnostic_rows = diagnostic_rows_acc;
                state.diagnostic_snapshot = false;
```

Also, in the "no live games" early state update at lines 739-748, add diagnostic rows there too:

```rust
                        state_tx_engine.send_modify(|state| {
                            state.markets = Vec::new();
                            state.live_sports = live_sports_empty;
                            state.filter_stats = tui::state::FilterStats {
                                live: filter_live,
                                pre_game: filter_pre_game,
                                closed: filter_closed,
                            };
                            state.next_game_start = earliest_commence;
                            state.diagnostic_rows = diagnostic_rows_acc;
                            state.diagnostic_snapshot = false;
                        });
```

Note: This requires moving the `diagnostic_rows_acc` variable declaration before the sleep-select block, or cloning it. Since the early-exit path uses `continue` after the sleep, the simplest approach is to set diagnostic rows in both paths.

**Step 4: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: compiles with no errors

**Step 5: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat(diagnostic): populate diagnostic rows during polling cycle"
```

---

### Task 6: Handle FetchDiagnostic command (one-shot fetch path)

**Files:**
- Modify: `kalshi-arb/src/main.rs` (handle the command in engine loop)

**Step 1: Handle FetchDiagnostic in the main command drain loop**

Replace the placeholder `TuiCommand::FetchDiagnostic => {}` in the first match block (around line 276) with real logic. Since `odds_feed` is owned by the polling loop and `fetch_odds` takes `&mut self`, we need to handle FetchDiagnostic inside the polling loop itself.

Replace the placeholder:

```rust
                    tui::TuiCommand::FetchDiagnostic => {
                        // One-shot fetch for diagnostic view
                        let mut diag_rows: Vec<tui::state::DiagnosticRow> = Vec::new();
                        for sport in &odds_sports {
                            match odds_feed.fetch_odds(sport).await {
                                Ok(updates) => {
                                    if let Some(quota) = odds_feed.last_quota() {
                                        api_request_times.push_back(Instant::now());
                                        let one_hour_ago = Instant::now() - Duration::from_secs(3600);
                                        while api_request_times.front().is_some_and(|&t| t < one_hour_ago) {
                                            api_request_times.pop_front();
                                        }
                                        let burn_rate = api_request_times.len() as f64;
                                        state_tx_engine.send_modify(|s| {
                                            s.api_requests_used = quota.requests_used;
                                            s.api_requests_remaining = quota.requests_remaining;
                                            s.api_burn_rate = burn_rate;
                                            s.api_hours_remaining = if burn_rate > 0.0 {
                                                quota.requests_remaining as f64 / burn_rate
                                            } else {
                                                f64::INFINITY
                                            };
                                        });
                                    }
                                    // Store commence times for live detection
                                    let ctimes: Vec<String> = updates.iter()
                                        .map(|u| u.commence_time.clone())
                                        .collect();
                                    sport_commence_times.insert(sport.to_string(), ctimes);

                                    diag_rows.extend(
                                        build_diagnostic_rows(&updates, sport, &market_index)
                                    );
                                }
                                Err(e) => {
                                    tracing::warn!(sport, error = %e, "diagnostic fetch failed");
                                }
                            }
                        }
                        state_tx_engine.send_modify(|s| {
                            s.diagnostic_rows = diag_rows;
                            s.diagnostic_snapshot = true;
                        });
                    }
```

**Step 2: Handle FetchDiagnostic in the sleep-select match block**

Replace the second placeholder (in the sleep-select around line 763) similarly. However, this block is inside a `tokio::select!` and doesn't have access to `odds_feed`. The simplest approach: just set a flag and let the main loop handle it on the next iteration.

Actually, looking at the code flow more carefully: the sleep-select block is only reached when `filter_live == 0`. When the command is received here, we should break out of the sleep and handle it in the main command drain at the top of the loop. The `continue` after the select already restarts the loop. So just capturing the command is enough:

```rust
                            tui::TuiCommand::FetchDiagnostic => {
                                // Will be handled at top of next loop iteration
                                // But we can't re-queue it. Handle inline:
                                let mut diag_rows: Vec<tui::state::DiagnosticRow> = Vec::new();
                                for sport_name in &odds_sports {
                                    match odds_feed.fetch_odds(sport_name).await {
                                        Ok(updates) => {
                                            if let Some(quota) = odds_feed.last_quota() {
                                                api_request_times.push_back(Instant::now());
                                                let one_hour_ago = Instant::now() - Duration::from_secs(3600);
                                                while api_request_times.front().is_some_and(|&t| t < one_hour_ago) {
                                                    api_request_times.pop_front();
                                                }
                                                let burn_rate = api_request_times.len() as f64;
                                                state_tx_engine.send_modify(|s| {
                                                    s.api_requests_used = quota.requests_used;
                                                    s.api_requests_remaining = quota.requests_remaining;
                                                    s.api_burn_rate = burn_rate;
                                                    s.api_hours_remaining = if burn_rate > 0.0 {
                                                        quota.requests_remaining as f64 / burn_rate
                                                    } else {
                                                        f64::INFINITY
                                                    };
                                                });
                                            }
                                            let ctimes: Vec<String> = updates.iter()
                                                .map(|u| u.commence_time.clone())
                                                .collect();
                                            sport_commence_times.insert(sport_name.to_string(), ctimes);

                                            diag_rows.extend(
                                                build_diagnostic_rows(&updates, sport_name, &market_index)
                                            );
                                        }
                                        Err(e) => {
                                            tracing::warn!(sport = sport_name.as_str(), error = %e, "diagnostic fetch failed");
                                        }
                                    }
                                }
                                state_tx_engine.send_modify(|s| {
                                    s.diagnostic_rows = diag_rows;
                                    s.diagnostic_snapshot = true;
                                });
                            }
```

**Step 3: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1`
Expected: compiles with no errors

**Step 4: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat(diagnostic): handle FetchDiagnostic for one-shot snapshot mode"
```

---

### Task 7: Manual testing and polish

**Files:**
- No new files

**Step 1: Build in release mode**

Run: `cd kalshi-arb && cargo build 2>&1`
Expected: builds successfully

**Step 2: Run clippy**

Run: `cd kalshi-arb && cargo clippy 2>&1`
Expected: no errors (warnings acceptable)

**Step 3: Run existing tests**

Run: `cd kalshi-arb && cargo test 2>&1`
Expected: all tests pass

**Step 4: Fix any clippy warnings or test failures**

Address issues as they arise.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address clippy warnings and test issues for diagnostic view"
```
