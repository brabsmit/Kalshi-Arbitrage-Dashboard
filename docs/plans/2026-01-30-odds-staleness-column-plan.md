# Odds Staleness Column Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `Stale` column to the live market TUI showing how old the bookmaker's last line update is, color-coded green/yellow/red by threshold.

**Architecture:** Add `staleness_secs: Option<u64>` to `MarketRow`, compute it from `BookmakerOdds.last_update` during `process_sport_updates()`, render it in `draw_markets()` with threshold-based coloring and responsive column hiding.

**Tech Stack:** Rust, ratatui, chrono

---

### Task 1: Add `staleness_secs` field to `MarketRow`

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs:64-73`

**Step 1: Add the field to the struct**

In `MarketRow` (line 64-73), add `staleness_secs` after `momentum_score`:

```rust
#[derive(Debug, Clone)]
pub struct MarketRow {
    pub ticker: String,
    pub fair_value: u32,
    pub bid: u32,
    pub ask: u32,
    pub edge: i32,
    pub action: String,
    pub latency_ms: Option<u64>,
    pub momentum_score: f64,
    pub staleness_secs: Option<u64>,
}
```

**Step 2: Verify it compiles**

Run: `~/.cargo/bin/cargo check --manifest-path kalshi-arb/Cargo.toml`
Expected: FAIL — `MarketRow` constructors in `main.rs` are missing the new field.

**Step 3: Commit**

```bash
git add kalshi-arb/src/tui/state.rs
git commit -m "feat: add staleness_secs field to MarketRow"
```

---

### Task 2: Compute staleness in `process_sport_updates()` and fix compilation

**Files:**
- Modify: `kalshi-arb/src/main.rs:281-290` (3-way MarketRow construction)
- Modify: `kalshi-arb/src/main.rs:426-435` (2-way MarketRow construction)

Both `MarketRow` construction sites use `bm` which is `update.bookmakers.first()`. The `bm.last_update` field is an ISO 8601 string.

**Step 1: Compute staleness and add it to both MarketRow construction sites**

Before the first `MarketRow` block (around line 281), compute staleness from `bm.last_update`:

```rust
let staleness_secs = chrono::DateTime::parse_from_rfc3339(&bm.last_update)
    .ok()
    .map(|dt| {
        let age = chrono::Utc::now() - dt.with_timezone(&chrono::Utc);
        age.num_seconds().max(0) as u64
    });
```

Add this same computation before the second `MarketRow` block (around line 426).

Then add `staleness_secs,` to both `MarketRow { ... }` blocks.

**Important:** The variable `bm` is already in scope at both sites — it's bound at line 163 (`if let Some(bm) = update.bookmakers.first()`). No new data plumbing needed.

**Step 2: Verify it compiles**

Run: `~/.cargo/bin/cargo check --manifest-path kalshi-arb/Cargo.toml`
Expected: PASS (warnings OK)

**Step 3: Run tests**

Run: `~/.cargo/bin/cargo test --manifest-path kalshi-arb/Cargo.toml`
Expected: All existing tests pass.

**Step 4: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat: compute odds staleness from bookmaker last_update"
```

---

### Task 3: Render the `Stale` column in the TUI

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:272-363`

This task modifies `draw_markets()` to add the `Stale` column between `Mom` and `Action`, with threshold-based coloring and responsive hiding.

**Step 1: Update column definitions for all three width breakpoints**

The column layout logic is at lines 274-323. The `Stale` column is 7 chars wide (e.g., `1802s` plus padding). It should appear at width >= 55 only (same visibility as `Latency`).

**Width < 45 (line 274-289):** No change — `Stale` is hidden.

**Width 45-54 (line 290-306):** No change — `Stale` is hidden.

**Width >= 55 (line 307-323):** Add `Stale` between `Mom` and `Action`:

```rust
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
            ticker_w, false, false,
        )
    };
```

Also add a `drop_stale` boolean: `true` when width < 55, `false` otherwise. Return it from each branch.

**Step 2: Add the `Stale` cell in the row-building closure**

In the row-building closure (lines 329-363), after the `Mom` cell and before the `Action` cell, insert:

```rust
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
```

**Step 3: Verify it compiles**

Run: `~/.cargo/bin/cargo check --manifest-path kalshi-arb/Cargo.toml`
Expected: PASS

**Step 4: Run tests**

Run: `~/.cargo/bin/cargo test --manifest-path kalshi-arb/Cargo.toml`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat: render Stale column with threshold-based coloring"
```

---

### Task 4: Final verification

**Step 1: Run full check + test + clippy**

```bash
~/.cargo/bin/cargo check --manifest-path kalshi-arb/Cargo.toml
~/.cargo/bin/cargo test --manifest-path kalshi-arb/Cargo.toml
~/.cargo/bin/cargo clippy --manifest-path kalshi-arb/Cargo.toml -- -W warnings
```

Expected: All pass (existing dead_code warnings are OK).

**Step 2: Verify the column layout math**

At width 55 (minimum for full layout), the columns should fit:
- Ticker: `55 - (5+5+5+6+5+7+8+8) = 55 - 49 = 6` chars — tight but functional.

At width 80 (typical terminal):
- Ticker: `80 - 49 = 31` chars — plenty of room.
