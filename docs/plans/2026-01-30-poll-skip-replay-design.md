# Fix: Live Markets Disappear on Poll-Skip Cycles

**Date:** 2026-01-30
**Status:** Design approved
**Scope:** `kalshi-arb/src/main.rs`

## Problem

A game initially displays under Live Markets for a few seconds, then disappears. The banner shows "No live markets" and the system enters sleep mode. The API never updates frequently enough to recover the dropped game in a timely manner.

## Root Cause

When a sport's poll is skipped due to throttle timing (lines 484-505), the skip path only accounts for **future** commence times (`ct_utc > now_utc`). Games that have already started are silently dropped from all filter accounting:

- `filter_live` is not incremented
- `filter_pre_game` is not incremented (commence is in the past)
- `filter_closed` is not incremented
- No market rows are generated

This causes `filter_live == 0` on the very next cycle (5s later), triggering the "No live markets" sleep branch. Since `earliest_commence` is also `None` (no future games), the sleep branch falls through to the display path with empty data.

**Sequence:**
1. Cycle 1: Fresh API fetch -> game is live -> `filter_live = 1` -> displayed
2. Cycle 2 (5s later): Poll skipped (throttle) -> skip path ignores already-started games -> `filter_live = 0`
3. System shows "No live markets" with empty display
4. Recovers only when throttle timer expires and next fresh fetch occurs

## Solution

### 1. Cache odds updates per sport

Add `sport_cached_updates: HashMap<String, Vec<OddsUpdate>>` alongside existing `sport_commence_times`.

On successful fetch, store the updates. On poll-skip, replay cached updates through the same processing pipeline.

### 2. Extract `process_sport_updates()` function

Extract the inline processing logic (current lines ~545-885) into a reusable function:

```rust
struct SportProcessResult {
    filter_live: usize,
    filter_pre_game: usize,
    filter_closed: usize,
    earliest_commence: Option<chrono::DateTime<chrono::Utc>>,
    rows: HashMap<String, MarketRow>,
}

fn process_sport_updates(
    updates: &[OddsUpdate],
    sport: &str,
    market_index: &matcher::MarketIndex,
    live_book_engine: &LiveBook,
    strategy_config: &config::StrategyConfig,
    momentum_config: &config::MomentumConfig,
    velocity_trackers: &mut HashMap<String, VelocityTracker>,
    book_pressure_trackers: &mut HashMap<String, BookPressureTracker>,
    scorer: &MomentumScorer,
    sim_mode: bool,
    state_tx: &watch::Sender<AppState>,
    is_replay: bool,  // skip velocity tracker pushes on cached data
) -> SportProcessResult
```

### 3. Integrate into main loop

```
for sport in &odds_sports {
    // ... existing is_live check, eligible_games pre-check ...

    let should_fetch = match last_poll.get(sport.as_str()) {
        Some(&last) => cycle_start.duration_since(last) >= interval,
        None => true,
    };

    let updates: Option<&Vec<OddsUpdate>> = if should_fetch {
        // Fresh API call
        match odds_feed.fetch_odds(sport).await {
            Ok(fetched) => {
                // Update caches (commence times, diagnostics, quota)
                sport_cached_updates.insert(sport.to_string(), fetched);
                sport_commence_times.insert(sport.to_string(), /* times */);
                last_poll.insert(sport.to_string(), Instant::now());
                sport_cached_updates.get(sport.as_str())
            }
            Err(e) => {
                // Fall back to cached data on error too
                sport_cached_updates.get(sport.as_str())
            }
        }
    } else {
        // Poll skipped — use cached data
        sport_cached_updates.get(sport.as_str())
    };

    if let Some(updates) = updates {
        let result = process_sport_updates(
            updates, sport, ..., /* is_replay: */ !should_fetch,
        );
        // Merge results into cycle accumulators
    }
}
```

### 4. Velocity tracker guard

When `is_replay == true`, skip `vt.push()` calls to avoid skewing momentum scores with duplicate data. The velocity tracker's dedup logic would handle identical values, but avoiding the push entirely is cleaner.

### 5. Diagnostic cache

Only update `diagnostic_cache` on fresh fetches, not replays. Diagnostics should reflect the latest API snapshot, not recycled data.

## What This Does NOT Change

- Sleep logic (lines 893-975) — still works the same, just won't trigger incorrectly
- Throttle intervals — still respected for API calls
- Market index — still built once at startup
- WebSocket orderbook — still provides live prices independently
- The `sport_has_eligible_games` pre-check — still skips dead sports entirely

## Risk

Low. The extracted function is a direct lift of existing inline code. The only new behavior is that cached data is reprocessed on skip cycles, which is strictly better than the current behavior of dropping live games.

One edge case: if a market closes on Kalshi between polls, the cached data will still show it as live until the next fresh fetch. This is acceptable — the market_index `status` check catches this, and WebSocket updates provide near-real-time price data regardless.
