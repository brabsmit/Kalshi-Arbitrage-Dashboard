# Odds Staleness Column — Design

## Summary

Add a `Stale` column to the live market table showing how old the stalest bookmaker line feeding into the devigged fair value is. Surfaces a risk signal: if the underlying odds data is stale, the edge calculation may be unreliable.

## Column Specification

- **Name:** `Stale`
- **Format:** Seconds with suffix — `12s`, `145s`, `1802s`
- **Position:** After `Mom`, before `Action`
  - Full layout: `Ticker | Fair | Bid | Ask | Edge | Mom | Stale | Action | Latency`
- **Color thresholds:**
  - Green: < 30s
  - Yellow: 30–60s
  - Red: > 60s

## Data Source

`BookmakerOdds.last_update` (ISO 8601 string) in `feed/types.rs:23`. This field already exists but is not currently used in any logic or display.

For each market row, staleness = `Utc::now() - oldest_bookmaker_last_update` across all bookmakers contributing to the devig for that market. Worst-case (oldest) is used because the fair value is only as trustworthy as its stalest input.

## Implementation Changes

### 1. MarketRow (tui/state.rs)

Add field:

```rust
pub staleness_secs: Option<u64>,
```

`None` when bookmaker timestamps are unavailable or unparseable.

### 2. process_sport_updates() (main.rs)

When building a `MarketRow`, after devigging:

1. Collect `last_update` strings from all bookmakers used in devig
2. Parse each as `DateTime<Utc>`
3. Find the oldest (minimum) timestamp
4. Compute `Utc::now() - oldest` as seconds
5. Set `staleness_secs = Some(seconds)`

### 3. Rendering (tui/render.rs)

- Add `Stale` column between `Mom` and `Action`
- Format: `format!("{}s", secs)` or `"—"` for `None`
- Color: green/yellow/red per thresholds above
- Responsive: drop `Stale` at same breakpoint as `Latency` (width < 55 chars)

## Responsive Breakpoints (updated)

| Width   | Visible columns                                          |
| ------- | -------------------------------------------------------- |
| >= 55   | Ticker, Fair, Bid, Ask, Edge, Mom, Stale, Action, Latency |
| 45–54   | Ticker, Fair, Bid, Ask, Edge, Mom, Action                |
| < 45    | Ticker, Fair, Bid, Ask, Edge, Mom                        |
