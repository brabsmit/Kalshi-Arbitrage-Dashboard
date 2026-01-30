# Live Games Filter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Filter the TUI and strategy engine to only show/act on games that are currently in progress with open Kalshi markets, and display a countdown + filter stats when no live games exist.

**Architecture:** Add `status` and `close_time` fields to `SideMarket` so Kalshi market metadata flows through the pipeline. In the engine loop, gate each game on two conditions (game started via `commence_time <= now`, market open via `close_time > now` + `status == "open"`). Track filter counts in a new `FilterStats` struct on `AppState`. Skip Odds API calls for sports with no live-eligible games. Sleep until the next game starts when nothing is live.

**Tech Stack:** Rust, chrono (already a dependency), ratatui (TUI rendering)

---

### Task 1: Add `status` and `close_time` to `SideMarket`

**Files:**
- Modify: `kalshi-arb/src/engine/matcher.rs:12-20`

**Step 1: Write the failing test**

Add a test in `kalshi-arb/src/engine/matcher.rs` at the bottom of the `mod tests` block:

```rust
#[test]
fn test_side_market_carries_status_and_close_time() {
    let sm = SideMarket {
        ticker: "KXNBAGAME-26JAN19LACWAS-LAC".to_string(),
        title: "Test".to_string(),
        yes_bid: 50,
        yes_ask: 55,
        no_bid: 45,
        no_ask: 50,
        status: "open".to_string(),
        close_time: Some("2026-01-20T04:00:00Z".to_string()),
    };
    assert_eq!(sm.status, "open");
    assert_eq!(sm.close_time.as_deref(), Some("2026-01-20T04:00:00Z"));
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test test_side_market_carries_status_and_close_time -- --nocapture`
Expected: FAIL — `SideMarket` doesn't have `status` or `close_time` fields.

**Step 3: Write minimal implementation**

In `kalshi-arb/src/engine/matcher.rs`, update the `SideMarket` struct (lines 12-20) to:

```rust
#[derive(Debug, Clone)]
pub struct SideMarket {
    pub ticker: String,
    pub title: String,
    pub yes_bid: u32,
    pub yes_ask: u32,
    pub no_bid: u32,
    pub no_ask: u32,
    pub status: String,
    pub close_time: Option<String>,
}
```

**Step 4: Fix the `SideMarket` construction in `main.rs`**

In `kalshi-arb/src/main.rs`, update the `SideMarket` construction (around line 125-132) to include the new fields:

```rust
let side_market = matcher::SideMarket {
    ticker: m.ticker.clone(),
    title: m.title.clone(),
    yes_bid: kalshi::types::dollars_to_cents(m.yes_bid_dollars.as_deref()),
    yes_ask: kalshi::types::dollars_to_cents(m.yes_ask_dollars.as_deref()),
    no_bid: kalshi::types::dollars_to_cents(m.no_bid_dollars.as_deref()),
    no_ask: kalshi::types::dollars_to_cents(m.no_ask_dollars.as_deref()),
    status: m.status.clone(),
    close_time: m.close_time.clone(),
};
```

**Step 5: Run test to verify it passes**

Run: `cargo test -- --nocapture`
Expected: All 52 tests PASS (51 existing + 1 new).

**Step 6: Commit**

```bash
git add kalshi-arb/src/engine/matcher.rs kalshi-arb/src/main.rs
git commit -m "feat: add status and close_time fields to SideMarket"
```

---

### Task 2: Add `FilterStats` and `next_game_start` to `AppState`

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs`

**Step 1: Write the failing test**

Add a test in `kalshi-arb/src/tui/state.rs`. First add a `#[cfg(test)] mod tests` block at the bottom of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_stats_default() {
        let state = AppState::new();
        assert_eq!(state.filter_stats.live, 0);
        assert_eq!(state.filter_stats.pre_game, 0);
        assert_eq!(state.filter_stats.closed, 0);
        assert!(state.next_game_start.is_none());
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test test_filter_stats_default -- --nocapture`
Expected: FAIL — `FilterStats` doesn't exist and `AppState` doesn't have `filter_stats` or `next_game_start`.

**Step 3: Write minimal implementation**

In `kalshi-arb/src/tui/state.rs`, add these imports at the top (after existing imports):

```rust
use chrono::{DateTime, Utc};
```

Add the `FilterStats` struct before `AppState`:

```rust
#[derive(Debug, Clone, Default)]
pub struct FilterStats {
    pub live: usize,
    pub pre_game: usize,
    pub closed: usize,
}
```

Add two fields to the `AppState` struct (after `live_sports`):

```rust
    pub filter_stats: FilterStats,
    pub next_game_start: Option<DateTime<Utc>>,
```

Add initialization in `AppState::new()` (after `live_sports: Vec::new()`):

```rust
            filter_stats: FilterStats::default(),
            next_game_start: None,
```

**Step 4: Run test to verify it passes**

Run: `cargo test -- --nocapture`
Expected: All 53 tests PASS.

**Step 5: Commit**

```bash
git add kalshi-arb/src/tui/state.rs
git commit -m "feat: add FilterStats and next_game_start to AppState"
```

---

### Task 3: Implement filtering logic in the engine loop

**Files:**
- Modify: `kalshi-arb/src/main.rs` (the engine loop, ~lines 213-651)

This task has no unit test because the filtering logic is deeply integrated into the `main` async loop. We verify it compiles and existing tests pass.

**Step 1: Add filter counters and commence time tracking**

Near the top of the engine loop (around line 232, after `accumulated_rows` declaration), add:

```rust
        // Filter statistics
        let mut filter_live: usize;
        let mut filter_pre_game: usize;
        let mut filter_closed: usize;
        let mut earliest_commence: Option<chrono::DateTime<chrono::Utc>> = None;
```

**Step 2: Reset counters at start of each polling cycle**

Inside the loop, after `let cycle_start = Instant::now();` (line 255), add:

```rust
            filter_live = 0;
            filter_pre_game = 0;
            filter_closed = 0;
            earliest_commence = None;
```

**Step 3: Add the live filter check for each game from Odds API**

In the odds update processing loop, right after the date is parsed and before the `is_3way` check (around line 326-336), add the live filter. Insert this block after `let Some(date) = date else { continue };` and before `let (lookup_home, lookup_away)`:

```rust
                                // --- Live filter: game must be in-progress + market open ---
                                let now_utc = chrono::Utc::now();
                                let commence_dt = chrono::DateTime::parse_from_rfc3339(
                                    &update.commence_time,
                                ).ok().map(|dt| dt.with_timezone(&chrono::Utc));

                                let game_started = commence_dt
                                    .is_some_and(|ct| ct <= now_utc);

                                if !game_started {
                                    filter_pre_game += 1;
                                    // Track earliest commence for countdown
                                    if let Some(ct) = commence_dt {
                                        earliest_commence = Some(match earliest_commence {
                                            Some(existing) => existing.min(ct),
                                            None => ct,
                                        });
                                    }
                                    continue;
                                }
```

**Step 4: Add per-side market status check**

For the 3-way evaluation path, inside the `for (side_opt, fair, label) in sides` loop, right after `let Some(side) = side_opt else { continue };` (around line 368), add:

```rust
                                            // Check Kalshi market is still open
                                            let market_open = side.status == "open"
                                                && side.close_time.as_deref()
                                                    .and_then(|ct| chrono::DateTime::parse_from_rfc3339(ct).ok())
                                                    .map_or(true, |ct| ct.with_timezone(&chrono::Utc) > now_utc);
                                            if !market_open {
                                                filter_closed += 1;
                                                continue;
                                            }
                                            filter_live += 1;
```

For the 2-way path, after the `find_match` call succeeds (right after `let fair = home_cents;` around line 495), add an equivalent check. We need to look up the `IndexedGame` to get the `SideMarket`'s status/close_time:

```rust
                                        // Check Kalshi market is still open
                                        let key = matcher::generate_key(sport, &lookup_home, &lookup_away, date);
                                        let game = key.and_then(|k| market_index.get(&k));
                                        let side_market = game.and_then(|g| {
                                            if mkt.is_inverse { g.away.as_ref() } else { g.home.as_ref() }
                                        });
                                        let market_open = side_market.is_some_and(|sm| {
                                            sm.status == "open"
                                                && sm.close_time.as_deref()
                                                    .and_then(|ct| chrono::DateTime::parse_from_rfc3339(ct).ok())
                                                    .map_or(true, |ct| ct.with_timezone(&chrono::Utc) > now_utc)
                                        });
                                        if !market_open {
                                            filter_closed += 1;
                                            continue;
                                        }
                                        filter_live += 1;
```

Note: the `continue` in the 2-way path continues the `for update in updates` loop since there is only one market per update (not a `sides` inner loop). Place this right after `let fair = home_cents;` and before the live book lookup.

**Step 5: Update TUI state with filter stats**

Replace the existing state update (around lines 634-637) to include filter stats and countdown:

```rust
            state_tx_engine.send_modify(|state| {
                state.markets = market_rows;
                state.live_sports = live_sports;
                state.filter_stats = tui::state::FilterStats {
                    live: filter_live,
                    pre_game: filter_pre_game,
                    closed: filter_closed,
                };
                state.next_game_start = earliest_commence;
            });
```

**Step 6: Run tests and verify compilation**

Run: `cargo build && cargo test`
Expected: Compiles cleanly, all tests PASS.

**Step 7: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat: filter engine loop to only evaluate live games"
```

---

### Task 4: Smart polling skip — skip Odds API calls for sports with no live-eligible games

**Files:**
- Modify: `kalshi-arb/src/main.rs`

**Step 1: Add per-sport liveness check before Odds API call**

In the engine loop, inside the `for sport in &odds_sports` block, right after the existing `is_live` check (lines 258-266) and before the quota check, add a pre-check that examines the Kalshi market index for this sport:

```rust
                // Pre-check: does this sport have any game that COULD be live?
                // Skip the API call entirely if all games are pre-game or closed.
                let now_utc = chrono::Utc::now();
                let sport_has_eligible_games = market_index.iter().any(|(key, game)| {
                    if key.sport != sport.to_uppercase().chars().filter(|c| c.is_ascii_alphabetic()).collect::<String>() {
                        return false;
                    }
                    // Check if any side market is open
                    let sides = [game.home.as_ref(), game.away.as_ref(), game.draw.as_ref()];
                    sides.iter().any(|s| {
                        s.is_some_and(|sm| {
                            sm.status == "open"
                                && sm.close_time.as_deref()
                                    .and_then(|ct| chrono::DateTime::parse_from_rfc3339(ct).ok())
                                    .map_or(true, |ct| ct.with_timezone(&chrono::Utc) > now_utc)
                        })
                    })
                });

                if !sport_has_eligible_games {
                    // Still count these games for filter stats
                    let sport_key: String = sport.to_uppercase().chars().filter(|c| c.is_ascii_alphabetic()).collect();
                    let sport_game_count = market_index.keys()
                        .filter(|k| k.sport == sport_key)
                        .count();
                    filter_closed += sport_game_count;
                    continue;
                }
```

Note: The `commence_time` check (game started) is only available once we have Odds API data. The per-sport skip only checks the Kalshi-side condition (market still open). The game-started check happens per-event inside the odds processing loop.

**Step 2: Implement sleep-until-next-game**

After the `for sport in &odds_sports` loop ends and before the state update, add sleep logic:

```rust
            // If nothing is live, sleep until the next game starts
            if filter_live == 0 {
                if let Some(next_start) = earliest_commence {
                    let now_utc = chrono::Utc::now();
                    if next_start > now_utc {
                        let wait = (next_start - now_utc).to_std().unwrap_or(Duration::from_secs(5));
                        // Cap at pre_game_poll_interval to allow index refresh
                        let capped_wait = wait.min(pre_game_poll_interval);

                        // Update TUI state before sleeping (so countdown is visible)
                        let live_sports: Vec<String> = Vec::new();
                        state_tx_engine.send_modify(|state| {
                            state.markets = Vec::new();
                            state.live_sports = live_sports;
                            state.filter_stats = tui::state::FilterStats {
                                live: filter_live,
                                pre_game: filter_pre_game,
                                closed: filter_closed,
                            };
                            state.next_game_start = earliest_commence;
                        });

                        // Sleep but wake early on TUI commands
                        tokio::select! {
                            _ = tokio::time::sleep(capped_wait) => {}
                            Some(cmd) = cmd_rx.recv() => {
                                match cmd {
                                    tui::TuiCommand::Pause => {
                                        is_paused = true;
                                        state_tx_engine.send_modify(|s| s.is_paused = true);
                                    }
                                    tui::TuiCommand::Resume => {
                                        is_paused = false;
                                        state_tx_engine.send_modify(|s| s.is_paused = false);
                                    }
                                    tui::TuiCommand::Quit => return,
                                }
                            }
                        }
                        continue; // restart loop (re-check everything)
                    }
                }
            }
```

**Step 3: Run tests and verify compilation**

Run: `cargo build && cargo test`
Expected: Compiles cleanly, all tests PASS.

**Step 4: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat: skip Odds API calls for sports with no eligible games and sleep until next game"
```

---

### Task 5: TUI — empty table message with countdown

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:203-328` (the `draw_markets` function)

**Step 1: Write the rendering logic**

In `kalshi-arb/src/tui/render.rs`, inside `draw_markets`, add an early return for the empty-table case. Insert right after `let inner_width = ...` (line 204), before the column layout:

```rust
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
            .alignment(ratatui::layout::Alignment::Center)
            .block(block);
        f.render_widget(para, area);
        return;
    }
```

Add the `Alignment` import to the existing use block at the top of `render.rs`. The import `ratatui::layout::Alignment` is used inline above, but if you prefer a named import, add it to the `layout` import line:

```rust
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect},
```

**Step 2: Run tests and verify compilation**

Run: `cargo build && cargo test`
Expected: Compiles cleanly, all tests PASS.

**Step 3: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat: show empty-table message with countdown when no live games"
```

---

### Task 6: TUI — filter stats in API status bar

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:506-526` (the `draw_api_status` function)

**Step 1: Append filter stats to the API status line**

Update `draw_api_status` to append filter counts:

```rust
fn draw_api_status(f: &mut Frame, state: &AppState, area: Rect) {
    let quota_str = format!(
        " API: {}/{} used | {:.1} req/hr | ~{:.1}h left",
        state.api_requests_used,
        state.api_requests_used + state.api_requests_remaining,
        state.api_burn_rate,
        state.api_hours_remaining,
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
```

**Step 2: Run tests and verify compilation**

Run: `cargo build && cargo test`
Expected: Compiles cleanly, all tests PASS.

**Step 3: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat: display filter stats in API status bar"
```

---

### Task 7: Final verification

**Step 1: Run full test suite**

Run: `cargo test`
Expected: All tests PASS.

**Step 2: Run clippy**

Run: `cargo clippy -- -W clippy::all`
Expected: No new warnings (pre-existing dead_code warnings are OK).

**Step 3: Verify build in release mode**

Run: `cargo build --release`
Expected: Compiles cleanly.

**Step 4: Commit any fixes from clippy/build**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: address clippy warnings from live games filter"
```
