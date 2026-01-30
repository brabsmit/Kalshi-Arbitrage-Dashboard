# Live Games Filter Design

## Goal

Only display and act on games that are currently live. Filter out pre-game and closed markets from the TUI and strategy evaluation. When the table is empty, show a summary with counts of what was filtered out and a countdown to the next game.

## Definition of "Live"

A game is live when BOTH conditions are true:

1. **Game has started**: `commence_time <= now` (from Odds API)
2. **Market still open on Kalshi**: `close_time > now` AND `status == "open"` (from Kalshi Market struct)

## Data Model Changes

### SideMarket (engine/matcher.rs)

Add two fields to carry Kalshi market metadata through the pipeline:

```rust
pub struct SideMarket {
    pub ticker: String,
    pub title: String,
    pub yes_bid: u32,
    pub yes_ask: u32,
    pub no_bid: u32,
    pub no_ask: u32,
    pub status: String,          // NEW
    pub close_time: Option<String>, // NEW
}
```

Populate these during index building in `main.rs` from the `Market` struct fields.

### AppState (tui/state.rs)

Add filter statistics and countdown:

```rust
pub struct FilterStats {
    pub live: usize,
    pub pre_game: usize,
    pub closed: usize,
}

pub struct AppState {
    // ...existing fields...
    pub filter_stats: FilterStats,
    pub next_game_start: Option<chrono::DateTime<Utc>>,
}
```

## Filtering Logic

Applied in `main.rs` during the odds polling loop, after matching a game to the Kalshi index but before strategy evaluation:

```
for each game from Odds API:
    match to Kalshi index
    if commence_time > now       -> pre_game += 1; skip
    if close_time <= now
       OR status != "open"       -> closed += 1; skip
    -> evaluate strategy, accumulate row, live += 1
```

Counters reset each polling cycle. Written to `FilterStats` when updating TUI state.

## Smart Polling Skip

### Per-sport skip

Before calling The Odds API for a sport, check indexed games for that sport:

- All games have `commence_time > now` (none started) -> skip API call, count as pre-game
- All games have `close_time <= now` (all ended) -> skip API call, count as closed
- Otherwise -> poll as normal

### Sleep-until-next-game

When no sport has any live games:

1. Find the earliest `commence_time` across all indexed pre-game markets
2. Sleep until that time (capped at normal pre-game poll interval to allow index refresh)
3. Only the odds polling loop sleeps; TUI event loop remains responsive

## TUI Display

### Empty table (no live games)

Replace the empty markets table with a centered message:

```
No live markets
8 pre-game · 0 closed

Next game starts in 1h 23m 04s
```

The countdown computes `next_game_start - now` on each render frame for smooth updates.

If no pre-game games exist either:

```
No live markets
0 pre-game · 12 closed

No upcoming games found
```

### Status bar (games are live)

Append filter stats to the existing API status line:

```
Odds API: 847/500 remaining | 3 live · 5 pre-game · 2 closed
```
