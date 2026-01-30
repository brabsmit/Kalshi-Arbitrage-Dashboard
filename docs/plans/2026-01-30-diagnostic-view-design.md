# Diagnostic View Design

## Purpose

A full-screen diagnostic view (toggled with `d`) that answers "why are there currently no live markets?" by showing all games returned by the-odds-api, their Kalshi matching status, and a human-readable reason for each.

## Data Model

New struct in `tui/state.rs`:

```rust
pub struct DiagnosticRow {
    pub sport: String,                  // e.g. "NBA", "NFL"
    pub matchup: String,                // e.g. "Lakers vs Celtics"
    pub commence_time: String,          // Displayed in ET
    pub game_status: String,            // "Live", "Upcoming (2h 15m)", "Completed"
    pub kalshi_ticker: Option<String>,  // Matched ticker or None
    pub market_status: Option<String>,  // "Open", "Closed", or None
    pub reason: String,                 // Diagnostic explanation
}
```

New fields in `AppState`:

```rust
pub diagnostic_rows: Vec<DiagnosticRow>,
pub diagnostic_snapshot: bool,  // true = one-shot data, false = live-updating
```

## Data Source (Hybrid)

- **Engine actively polling (live games exist):** Diagnostic rows are populated each polling cycle alongside the existing `MarketRow` generation. No extra API calls. `diagnostic_snapshot = false`.
- **Engine idle (no live games):** Pressing `d` sends `TuiCommand::FetchDiagnostic` to the engine, which triggers a one-shot fetch for all configured sports, builds diagnostic rows, and updates API quota counters. `diagnostic_snapshot = true`.

## View Mode & Input

New variant in `FocusedPanel` enum:

```rust
Diagnostic
```

Keyboard handling:

- **Global mode:** `d` opens diagnostic view. If engine is idle, also triggers one-shot fetch.
- **Diagnostic mode:** `d` or `Esc` closes. `j`/`k`/Up/Down scroll. `g`/`G` jump to top/bottom. `q` quits app.

New TUI command:

```rust
TuiCommand::FetchDiagnostic
```

## Rendering

Full-screen layout:

- **Top bar:** "Diagnostic View - All Games from The Odds API" + "(Live)" or "(Snapshot)" tag
- **Table body:** Grouped by sport (alphabetical), sorted by commence time within each group
- **Bottom bar:** "d/Esc: close | j/k: scroll | g/G: top/bottom"

### Table Columns

| Matchup | Commence (ET) | Status | Kalshi Ticker | Market | Reason |

Sport is displayed as a header row spanning the full width (e.g. `── NBA ──`), not as a separate column.

### Color Coding

| Element | Color |
|---------|-------|
| Status: "Live" | Green |
| Status: "Upcoming" | Yellow |
| Status: "Completed" | Dark Gray |
| Market: "Open" | Green |
| Market: "Closed" | Red |
| Reason: "No match found" | Dark Gray |
| Reason: "Live & tradeable" | Green/Bold |

### Reason Column Logic

| Condition | Reason Text |
|-----------|-------------|
| No Kalshi ticker match | "No match found" |
| Ticker matched, market closed | "Market closed" |
| Game not yet started | "Not started yet" |
| Game live, market open | "Live & tradeable" |
| Game completed | "Game ended" |

## One-Shot Fetch Flow

1. TUI sends `TuiCommand::FetchDiagnostic`
2. Engine receives command, calls `fetch_odds()` for all configured sports
3. Builds `DiagnosticRow` list by matching each game against `MarketIndex`
4. Updates `AppState.diagnostic_rows` and sets `diagnostic_snapshot = true`
5. Updates `api_requests_used` and `api_requests_remaining`
