# Multi-Source Diagnostic Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the diagnostic view to show games from all data sources (ESPN score feeds + odds feeds) so users can see what's available and where each game comes from.

**Architecture:** Currently, the diagnostic view (`d` key) only fetches and displays games from odds sources (The Odds API, DraftKings, Bovada). We'll extend it to also fetch games from score feeds (ESPN for NCAAB/NBA), tag each row with its source, add a Source column to the display, and maintain the existing grouping-by-sport behavior.

**Tech Stack:** Rust, ratatui for TUI, existing ScorePoller and OddsFeed abstractions

---

## Task 1: Add source field to DiagnosticRow

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs:14-22`

**Step 1: Add source field to DiagnosticRow struct**

Edit `kalshi-arb/src/tui/state.rs` and add the `source` field:

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
    pub source: String,  // NEW: "ESPN", "TheOddsAPI", "DraftKings", "Bovada"
}
```

**Step 2: Verify compilation**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe build` from `kalshi-arb/` directory

Expected: Build should fail with errors about missing `source` field in DiagnosticRow construction sites

**Step 3: Commit**

```bash
git add kalshi-arb/src/tui/state.rs
git commit -m "feat(diagnostic): add source field to DiagnosticRow

Prepares for multi-source diagnostic display by adding a source field
to track which data source (ESPN, TheOddsAPI, etc) each game came from.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Update build_diagnostic_rows to tag odds source

**Files:**
- Modify: `kalshi-arb/src/pipeline.rs:569-658`

**Step 1: Add source_name parameter to build_diagnostic_rows**

Update function signature and add source to DiagnosticRow construction:

```rust
pub fn build_diagnostic_rows(
    updates: &[OddsUpdate],
    sport: &str,
    market_index: &matcher::MarketIndex,
    source_name: &str,  // NEW parameter
) -> Vec<DiagnosticRow> {
    // ... existing code ...

    updates
        .iter()
        .map(|update| {
            // ... existing matchup, commence_time, game_status, matching logic ...

            DiagnosticRow {
                sport: sport.to_string(),
                matchup,
                commence_time: commence_et,
                game_status,
                kalshi_ticker,
                market_status,
                reason,
                source: source_name.to_string(),  // NEW field
            }
        })
        .collect()
}
```

**Step 2: Verify compilation**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe build` from `kalshi-arb/`

Expected: Build should fail with errors about missing `source_name` argument at call sites

**Step 3: Commit**

```bash
git add kalshi-arb/src/pipeline.rs
git commit -m "feat(diagnostic): add source tagging to build_diagnostic_rows

Update build_diagnostic_rows to accept source_name parameter and tag
each DiagnosticRow with its data source.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create build_diagnostic_rows_from_scores function

**Files:**
- Modify: `kalshi-arb/src/pipeline.rs` (add new function after build_diagnostic_rows)
- Modify: `kalshi-arb/src/feed/score_feed.rs:12-25` (reference ScoreUpdate struct)

**Step 1: Write the function**

Add this function in `kalshi-arb/src/pipeline.rs` right after `build_diagnostic_rows`:

```rust
/// Build diagnostic rows from score updates for a given sport.
pub fn build_diagnostic_rows_from_scores(
    updates: &[crate::feed::score_feed::ScoreUpdate],
    sport: &str,
    market_index: &matcher::MarketIndex,
    source_name: &str,
) -> Vec<DiagnosticRow> {
    let eastern = chrono::FixedOffset::west_opt(5 * 3600)
        .unwrap_or_else(|| chrono::FixedOffset::west_opt(0).unwrap());
    let now_utc = chrono::Utc::now();

    updates
        .iter()
        .map(|update| {
            let matchup = format!("{} vs {}", update.away_team, update.home_team);

            // Format commence time: for score feeds we don't have it, use "—"
            // Game status from ScoreUpdate
            let game_status = match &update.game_status {
                crate::feed::score_feed::GameStatus::PreGame => "Pre-Game".to_string(),
                crate::feed::score_feed::GameStatus::Live => format!(
                    "Live (P{} {}:{}-{})",
                    update.period,
                    update.home_score,
                    update.away_score
                ),
                crate::feed::score_feed::GameStatus::Halftime => "Halftime".to_string(),
                crate::feed::score_feed::GameStatus::Finished => "Final".to_string(),
            };

            // Score feeds don't have a scheduled commence time in the struct,
            // so we use a placeholder
            let commence_time = "—".to_string();

            // Try to match against Kalshi markets
            // We don't have a date from ScoreUpdate, so we'll use today's date
            let today = chrono::Utc::now().with_timezone(&eastern).date_naive();

            let (lookup_home, lookup_away) = if sport == "mma" {
                (crate::last_name(&update.home_team).to_string(),
                 crate::last_name(&update.away_team).to_string())
            } else {
                (update.home_team.clone(), update.away_team.clone())
            };

            let matched_game = matcher::generate_key(sport, &lookup_home, &lookup_away, today)
                .and_then(|k| market_index.get(&k));

            let (kalshi_ticker, market_status, reason) = match matched_game {
                Some(game) => {
                    let side = game.home.as_ref()
                        .or(game.away.as_ref())
                        .or(game.draw.as_ref());

                    match side {
                        Some(sm) => {
                            let market_st = if sm.status == "open" || sm.status == "active" {
                                "Open"
                            } else {
                                "Closed"
                            };
                            let reason = match &update.game_status {
                                crate::feed::score_feed::GameStatus::Live => {
                                    "Live & tradeable".to_string()
                                }
                                crate::feed::score_feed::GameStatus::PreGame => {
                                    "Not started yet".to_string()
                                }
                                _ => "Game ended".to_string(),
                            };
                            (Some(sm.ticker.clone()), Some(market_st.to_string()), reason)
                        }
                        None => (None, None, "No match found".to_string()),
                    }
                }
                None => (None, None, "No match found".to_string()),
            };

            DiagnosticRow {
                sport: sport.to_string(),
                matchup,
                commence_time,
                game_status,
                kalshi_ticker,
                market_status,
                reason,
                source: source_name.to_string(),
            }
        })
        .collect()
}
```

**Step 2: Verify compilation**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe build` from `kalshi-arb/`

Expected: Should compile successfully (no call sites yet)

**Step 3: Commit**

```bash
git add kalshi-arb/src/pipeline.rs
git commit -m "feat(diagnostic): add build_diagnostic_rows_from_scores

Create function to build diagnostic rows from score feed data, enabling
multi-source diagnostic view. Handles ScoreUpdate conversion to
DiagnosticRow format with proper status mapping and market matching.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Update handle_fetch_diagnostic to call build_diagnostic_rows with source

**Files:**
- Modify: `kalshi-arb/src/main.rs:128-175`

**Step 1: Update odds-based diagnostic fetching to include source name**

Modify the loop in `handle_fetch_diagnostic` to pass source name:

```rust
async fn handle_fetch_diagnostic(
    sport_pipelines: &mut [pipeline::SportPipeline],
    odds_sources: &mut HashMap<String, Box<dyn OddsFeed>>,
    api_request_times: &mut VecDeque<Instant>,
    state_tx: &watch::Sender<AppState>,
    market_index: &engine::matcher::MarketIndex,
) {
    let mut diag_rows: Vec<tui::state::DiagnosticRow> = Vec::new();
    for pipe in sport_pipelines.iter_mut() {
        if !pipe.enabled { continue; }
        if let Some(source) = odds_sources.get_mut(&pipe.odds_source) {
            match source.fetch_odds(&pipe.key).await {
                Ok(updates) => {
                    if let Some(quota) = source.last_quota() {
                        api_request_times.push_back(Instant::now());
                        let one_hour_ago = Instant::now() - Duration::from_secs(3600);
                        while api_request_times.front().is_some_and(|&t| t < one_hour_ago) {
                            api_request_times.pop_front();
                        }
                        let burn_rate = api_request_times.len() as f64;
                        state_tx.send_modify(|s| {
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
                    pipe.commence_times = updates.iter()
                        .map(|u| u.commence_time.clone()).collect();

                    // Format source name nicely (e.g., "the-odds-api" -> "TheOddsAPI")
                    let source_name = format_source_name(&pipe.odds_source);
                    diag_rows.extend(
                        pipeline::build_diagnostic_rows(&updates, &pipe.key, market_index, &source_name)
                    );
                }
                Err(e) => {
                    tracing::warn!(sport = pipe.key.as_str(), error = %e, "diagnostic fetch failed");
                }
            }
        }
    }
    state_tx.send_modify(|s| {
        s.diagnostic_rows = diag_rows;
        s.diagnostic_snapshot = true;
    });
}

// Helper function to format source names
fn format_source_name(source_key: &str) -> String {
    match source_key {
        "the-odds-api" => "TheOddsAPI".to_string(),
        "draftkings" => "DraftKings".to_string(),
        "scraped-bovada" => "Bovada".to_string(),
        other => other.to_string(),
    }
}
```

**Step 2: Verify compilation**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe build` from `kalshi-arb/`

Expected: Should compile successfully

**Step 3: Test manually**

Run the app, press `d` to open diagnostic view, verify it still works and shows games

Expected: Diagnostic view shows games from odds sources (no source column visible yet)

**Step 4: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat(diagnostic): pass source name to build_diagnostic_rows

Update handle_fetch_diagnostic to pass formatted source names when
building diagnostic rows from odds feeds. Adds format_source_name helper.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add score feed fetching to handle_fetch_diagnostic

**Files:**
- Modify: `kalshi-arb/src/main.rs:128-175` (extend handle_fetch_diagnostic)
- Reference: `kalshi-arb/src/pipeline.rs` (SportPipeline struct has score_poller)

**Step 1: Extend handle_fetch_diagnostic to fetch from score feeds**

Add score feed fetching after odds feed loop:

```rust
async fn handle_fetch_diagnostic(
    sport_pipelines: &mut [pipeline::SportPipeline],
    odds_sources: &mut HashMap<String, Box<dyn OddsFeed>>,
    api_request_times: &mut VecDeque<Instant>,
    state_tx: &watch::Sender<AppState>,
    market_index: &engine::matcher::MarketIndex,
) {
    let mut diag_rows: Vec<tui::state::DiagnosticRow> = Vec::new();

    // Fetch from odds sources (existing code)
    for pipe in sport_pipelines.iter_mut() {
        if !pipe.enabled { continue; }
        if let Some(source) = odds_sources.get_mut(&pipe.odds_source) {
            match source.fetch_odds(&pipe.key).await {
                Ok(updates) => {
                    if let Some(quota) = source.last_quota() {
                        api_request_times.push_back(Instant::now());
                        let one_hour_ago = Instant::now() - Duration::from_secs(3600);
                        while api_request_times.front().is_some_and(|&t| t < one_hour_ago) {
                            api_request_times.pop_front();
                        }
                        let burn_rate = api_request_times.len() as f64;
                        state_tx.send_modify(|s| {
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
                    pipe.commence_times = updates.iter()
                        .map(|u| u.commence_time.clone()).collect();

                    let source_name = format_source_name(&pipe.odds_source);
                    diag_rows.extend(
                        pipeline::build_diagnostic_rows(&updates, &pipe.key, market_index, &source_name)
                    );
                }
                Err(e) => {
                    tracing::warn!(sport = pipe.key.as_str(), source = "odds", error = %e, "diagnostic fetch failed");
                }
            }
        }
    }

    // NEW: Fetch from score feeds
    for pipe in sport_pipelines.iter_mut() {
        if !pipe.enabled { continue; }
        if let Some(ref mut poller) = pipe.score_poller {
            match poller.fetch().await {
                Ok(updates) => {
                    // Determine source name based on which URL was used
                    let source_name = if poller.primary_url().contains("nba.com") {
                        "NBA"
                    } else if poller.primary_url().contains("espn.com") {
                        "ESPN"
                    } else {
                        "ScoreFeed"
                    };

                    diag_rows.extend(
                        pipeline::build_diagnostic_rows_from_scores(
                            &updates,
                            &pipe.key,
                            market_index,
                            source_name,
                        )
                    );
                }
                Err(e) => {
                    tracing::warn!(sport = pipe.key.as_str(), source = "score", error = %e, "diagnostic fetch failed");
                }
            }
        }
    }

    state_tx.send_modify(|s| {
        s.diagnostic_rows = diag_rows;
        s.diagnostic_snapshot = true;
    });
}
```

**Step 2: Verify compilation**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe build` from `kalshi-arb/`

Expected: Should compile successfully

**Step 3: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat(diagnostic): add score feed fetching to diagnostic view

Extend handle_fetch_diagnostic to fetch games from score feeds (ESPN/NBA)
in addition to odds sources. Each game is tagged with its source.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add Source column to diagnostic display

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:956-1094` (draw_diagnostic function)

**Step 1: Update diagnostic table headers and constraints**

Modify the `draw_diagnostic` function to add a Source column:

```rust
fn draw_diagnostic(f: &mut Frame, state: &AppState, area: Rect) {
    let inner_width = area.width.saturating_sub(2) as usize;
    let visible_lines = area.height.saturating_sub(4) as usize;

    if state.diagnostic_rows.is_empty() {
        // ... existing empty state rendering ...
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
```

**Step 2: Verify compilation**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe build` from `kalshi-arb/`

Expected: Should compile successfully

**Step 3: Test manually**

Run the app, press `d`, verify Source column appears (on wide screens) showing source names

Expected: Diagnostic view shows Source column with "ESPN", "TheOddsAPI", etc.

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(diagnostic): add Source column to diagnostic display

Add Source column to diagnostic table showing which data feed each game
came from. Column is responsive (hidden on narrow terminals).

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Update diagnostic header to reflect multi-source nature

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:927-954` (draw_diagnostic_header function)

**Step 1: Update header text**

Change the header from "All Games from The Odds API" to "All Games from All Sources":

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
            " All Games from All Sources",  // UPDATED TEXT
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

**Step 2: Verify compilation**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe build` from `kalshi-arb/`

Expected: Should compile successfully

**Step 3: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat(diagnostic): update header to reflect multi-source data

Change diagnostic header from 'All Games from The Odds API' to
'All Games from All Sources' to reflect the expanded data fetching.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Handle empty commence_time gracefully in display

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:956-1094` (if needed based on testing)

**Step 1: Test with score feeds that have no commence_time**

Run the app, press `d`, verify that games from ESPN show "—" in Commence column

Expected: Score feed games show "—" or similar placeholder in Commence column

**Step 2: If issues arise, update display logic**

If the "—" placeholder doesn't render well, update the cell rendering to handle it better.

**Step 3: Commit (if changes made)**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "fix(diagnostic): improve commence_time placeholder rendering

Ensure games from score feeds (which lack commence_time) display
cleanly with appropriate placeholder.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Add integration test for multi-source diagnostics

**Files:**
- Create: `kalshi-arb/tests/diagnostic_multi_source.rs`

**Step 1: Write integration test**

Create a new integration test file:

```rust
use kalshi_arb::engine::matcher::{MarketIndex, MatchedGame, SideMarket};
use kalshi_arb::feed::score_feed::{GameStatus, ScoreSource, ScoreUpdate};
use kalshi_arb::feed::OddsUpdate;
use kalshi_arb::pipeline::{build_diagnostic_rows, build_diagnostic_rows_from_scores};
use std::collections::HashMap;

#[test]
fn test_diagnostic_rows_from_odds_source() {
    let market_index: MarketIndex = HashMap::new();

    let odds_updates = vec![
        OddsUpdate {
            home_team: "Duke".to_string(),
            away_team: "UNC".to_string(),
            commence_time: "2026-02-01T19:00:00Z".to_string(),
            bookmaker: "DraftKings".to_string(),
            home_price: -150,
            away_price: 130,
        },
    ];

    let rows = build_diagnostic_rows(&odds_updates, "basketball_ncaab", &market_index, "DraftKings");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].sport, "basketball_ncaab");
    assert_eq!(rows[0].matchup, "UNC vs Duke");
    assert_eq!(rows[0].source, "DraftKings");
}

#[test]
fn test_diagnostic_rows_from_score_source() {
    let market_index: MarketIndex = HashMap::new();

    let score_updates = vec![
        ScoreUpdate {
            game_id: "game123".to_string(),
            home_team: "Duke".to_string(),
            away_team: "UNC".to_string(),
            home_score: 42,
            away_score: 38,
            period: 1,
            clock_seconds: 300,
            total_elapsed_seconds: 900,
            game_status: GameStatus::Live,
            source: ScoreSource::Espn,
        },
    ];

    let rows = build_diagnostic_rows_from_scores(&score_updates, "basketball_ncaab", &market_index, "ESPN");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].sport, "basketball_ncaab");
    assert_eq!(rows[0].matchup, "UNC vs Duke");
    assert_eq!(rows[0].source, "ESPN");
    assert!(rows[0].game_status.contains("Live"));
}

#[test]
fn test_multi_source_diagnostic_rows_combined() {
    let market_index: MarketIndex = HashMap::new();

    let odds_updates = vec![
        OddsUpdate {
            home_team: "Duke".to_string(),
            away_team: "UNC".to_string(),
            commence_time: "2026-02-01T19:00:00Z".to_string(),
            bookmaker: "DraftKings".to_string(),
            home_price: -150,
            away_price: 130,
        },
    ];

    let score_updates = vec![
        ScoreUpdate {
            game_id: "game123".to_string(),
            home_team: "Kansas".to_string(),
            away_team: "Kentucky".to_string(),
            home_score: 28,
            away_score: 25,
            period: 1,
            clock_seconds: 600,
            total_elapsed_seconds: 600,
            game_status: GameStatus::Live,
            source: ScoreSource::Espn,
        },
    ];

    let mut all_rows = Vec::new();
    all_rows.extend(build_diagnostic_rows(&odds_updates, "basketball_ncaab", &market_index, "DraftKings"));
    all_rows.extend(build_diagnostic_rows_from_scores(&score_updates, "basketball_ncaab", &market_index, "ESPN"));

    assert_eq!(all_rows.len(), 2);
    assert_eq!(all_rows[0].source, "DraftKings");
    assert_eq!(all_rows[1].source, "ESPN");
}
```

**Step 2: Run the test**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe test diagnostic_multi_source` from `kalshi-arb/`

Expected: All tests pass

**Step 3: Commit**

```bash
git add kalshi-arb/tests/diagnostic_multi_source.rs
git commit -m "test(diagnostic): add integration tests for multi-source diagnostics

Add tests verifying diagnostic rows can be built from both odds sources
and score feeds, and that they can be combined correctly.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Run full test suite and verify

**Files:**
- N/A (verification step)

**Step 1: Run full test suite**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe test` from `kalshi-arb/`

Expected: All 178+ tests pass (including new integration tests)

**Step 2: Manual testing**

1. Run the app: `/c/Users/Bryan/.cargo/bin/cargo.exe run` from `kalshi-arb/`
2. Press `d` to open diagnostic view
3. Verify games from multiple sources appear
4. Verify Source column shows correct source names
5. Verify grouping by sport still works
6. Test on narrow terminal (resize) to verify Source column hides gracefully

Expected:
- Games from ESPN and odds sources both appear
- Source column visible on wide screens, hidden on narrow
- No crashes or rendering issues

**Step 3: Document verification**

No commit needed (verification only)

---

## Task 11: Update NCAAB_DATA_FLOW_ANALYSIS.md with diagnostic changes

**Files:**
- Modify: `kalshi-arb/NCAAB_DATA_FLOW_ANALYSIS.md` (add section documenting diagnostic view)

**Step 1: Add documentation section**

Add this section at the end of the file:

```markdown
## Diagnostic View

The diagnostic view (`d` key in TUI) provides visibility into all games across all data sources.

### Data Sources

Games are fetched from:
1. **Score Feeds**: ESPN, NBA API (for live scores)
2. **Odds Feeds**: The Odds API, DraftKings, Bovada (for betting lines)

### Display Columns

| Column | Description |
|--------|-------------|
| Matchup | Away vs Home team names |
| Commence(ET) | Scheduled start time (ET), or "—" for score feeds |
| Status | Pre-Game, Live (with score), Upcoming, Final |
| Kalshi Ticker | Matched Kalshi market ticker, or "—" if no match |
| Market | Open, Closed, or "—" if no match |
| Reason | "Live & tradeable", "No match found", etc. |
| Source | ESPN, NBA, TheOddsAPI, DraftKings, Bovada |

### Matching Logic

Each game is matched against the Kalshi MarketIndex using:
- Sport type
- Team names (normalized)
- Date (extracted from commence_time for odds; today's date for score feeds)

### Implementation

- `pipeline::build_diagnostic_rows()` - Converts OddsUpdate to DiagnosticRow
- `pipeline::build_diagnostic_rows_from_scores()` - Converts ScoreUpdate to DiagnosticRow
- `main::handle_fetch_diagnostic()` - Fetches from all sources and combines rows
- `tui::render::draw_diagnostic()` - Renders multi-source table with grouping by sport
```

**Step 2: Verify markdown renders correctly**

Check the file in a markdown viewer to ensure formatting is correct

**Step 3: Commit**

```bash
git add kalshi-arb/NCAAB_DATA_FLOW_ANALYSIS.md
git commit -m "docs: document multi-source diagnostic view

Add documentation for diagnostic view showing how it fetches from
multiple sources and displays combined game data.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Final verification and cleanup

**Files:**
- N/A (verification and cleanup)

**Step 1: Run full test suite one more time**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe test` from `kalshi-arb/`

Expected: All tests pass

**Step 2: Build release binary**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe build --release` from `kalshi-arb/`

Expected: Build succeeds with no errors (warnings OK)

**Step 3: Run clippy for code quality**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe clippy -- -D warnings` from `kalshi-arb/`

Expected: No clippy warnings (or only acceptable ones)

**Step 4: Format code**

Run: `/c/Users/Bryan/.cargo/bin/cargo.exe fmt` from `kalshi-arb/`

Expected: Code is formatted consistently

**Step 5: Final commit if formatting changed**

```bash
git add -A
git commit -m "style: apply rustfmt

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

**Step 6: Review all commits**

Run: `git log --oneline main..HEAD`

Expected: Clean commit history with descriptive messages

---

## Completion Checklist

- [ ] DiagnosticRow has source field
- [ ] build_diagnostic_rows accepts and uses source_name parameter
- [ ] build_diagnostic_rows_from_scores created for score feeds
- [ ] handle_fetch_diagnostic fetches from both odds and score sources
- [ ] Diagnostic display shows Source column (responsive)
- [ ] Diagnostic header updated to "All Sources"
- [ ] Integration tests added and passing
- [ ] Full test suite passes (178+ tests)
- [ ] Manual testing completed successfully
- [ ] NCAAB_DATA_FLOW_ANALYSIS.md updated
- [ ] Code formatted with rustfmt
- [ ] Clean commit history

---

## Post-Implementation

After completing all tasks:

1. Merge feature branch to main
2. Test on production-like data (if available)
3. Monitor for any performance issues with increased API calls
4. Consider adding caching if diagnostic fetch becomes slow
