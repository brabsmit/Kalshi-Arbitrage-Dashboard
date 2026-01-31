# NBA Score Feed Fair Value — Design

## Problem

The current fair value computation relies on The Odds API for sportsbook odds. This has two problems:

1. **Cost:** API subscriptions are expensive and quota-limited.
2. **Latency:** 20-second live polling + sportsbook aggregation lag means 20-40 seconds before a scoring event is reflected in fair value. Edges close before we can act.

## Approach

Replace sportsbook odds with **live score feeds + a precomputed win probability table** for NBA markets. React to the actual game event (the primary information) rather than waiting for a derivative signal (odds).

```
Current:  Odds API (20s poll) → Devig → Fair Value → Edge Detection
Proposed: Score API (2-3s poll) → WinProb Table Lookup → Fair Value → Edge Detection
```

Total latency drops from 20-40 seconds to 4-8 seconds.

## Scope

- **NBA only** for initial implementation. Other sports continue using The Odds API.
- Both feeds run in parallel — no big-bang migration.
- If NBA proves profitable, extend to NFL/MLB/NHL with their own win probability tables.

---

## New Components

### ScorePoller

An async Tokio task that polls NBA live game state every 2-3 seconds during live games. Emits `ScoreUpdate` events when state changes.

**Data sources (with failover):**

- **Primary:** NBA API (`nba.com/stats`) — unofficial, fast updates (2-5s after event), no API key needed.
- **Fallback:** ESPN API — unofficial but extremely stable, slightly slower updates, no API key.

**Polling intervals:**

| Game State | Interval |
|---|---|
| Pre-game | 60 seconds (detect game start) |
| Live | 2-3 seconds |
| Post-game | Stop polling, emit final update |

**Failover logic:**

- Each poll hits NBA API first with a 1-second timeout.
- On failure, immediately retry with ESPN.
- If both fail, skip the cycle (last known state remains valid for a few seconds).
- After 5 consecutive failures on primary, swap ESPN to primary until NBA recovers.

**ScoreUpdate struct:**

```rust
struct ScoreUpdate {
    game_id: String,
    home_score: u16,
    away_score: u16,
    period: u8,               // 1-4, 5+ for overtime
    clock_seconds: u16,       // seconds remaining in period
    total_elapsed_seconds: u16, // precomputed for table lookup
    source: ScoreSource,      // Nba | Espn
}
```

`total_elapsed_seconds` is precomputed: `(period - 1) * 720 + (720 - clock_seconds)`, capped at 2880 for regulation. This keeps period math out of the hot path.

Only emit a `ScoreUpdate` when state actually changes — avoid spamming the engine with identical data.

### WinProbTable

A static, hardcoded lookup table: `(score_differential, time_bucket)` → `home_win_probability` (0-100).

**Dimensions:**

- **Score differential:** -40 to +40 (81 values). Beyond ±40 clamps to 0 or 100.
- **Time bucket:** 0 to 96 (97 values). Each bucket = 30 seconds of game time.
- **Overtime:** Separate small table, same score-diff axis, 10 buckets per OT period (5 minutes at 30-second granularity).

**Storage:** A flat `[u8; 81 * 97]` array. Index: `table[(diff + 40) * 97 + time_bucket]`. Total size: ~7.9 KB. Compiled into the binary as a `const`.

**Source data:** Published NBA win probability curves (Inpredictable, sports analytics research). Well-known pattern: early differential matters less, late differential matters enormously.

**Boundary cases:**

- Pre-game: Fair value defaults to home court advantage baseline (~57-58%) or skip trading until tip-off.
- Game ended: Fair value is 100 or 0 based on final score.
- Clock sync error: At most one bucket (30s) of error → fraction of a percentage point in fair value, negligible vs 2-5 cent edge thresholds.

---

## Integration With Existing Engine

### Matcher

`matcher.rs` already resolves Kalshi tickers to games. Add a mapping from NBA API game IDs to internal game representations, built at startup from team names + game dates. Same approach as existing Odds API event matching.

### Strategy

For NBA games, replace the `devig()` → `fair_value_cents()` path. On `ScoreUpdate`:

```
score_diff = home_score - away_score
time_bucket = total_elapsed_seconds / 30
home_fair = win_prob_table.lookup(score_diff, time_bucket)
away_fair = 100 - home_fair
```

Existing `Signal` logic (taker/maker/skip thresholds) and fee calculation unchanged.

### Momentum Scoring

- **Velocity:** Now tracks score-event velocity instead of odds changes. A rapid run of scoring (e.g., 10-0 run) maps to high velocity.
- **Book pressure:** Unchanged (Kalshi orderbook depth).
- **Composite:** Still 60% velocity + 40% book pressure.

### Config

Add `[score_feed]` section to `config.toml`:

```toml
[score_feed]
nba_api_url = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json"
espn_api_url = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
live_poll_interval_s = 3
pre_game_poll_interval_s = 60
failover_threshold = 5
request_timeout_ms = 1000
```

`[odds_feed]` remains for non-NBA sports.

---

## Latency Edge Analysis

**Scenario: Basket scored during a live NBA game.**

| Path | Steps | Total Latency |
|---|---|---|
| Current (sportsbook) | Score → broadcast → sportsbook model → Odds API aggregation → 20s poll → devig | 20-40s |
| Proposed (score feed) | Score → NBA API update (2-5s) → 2-3s poll → table lookup | 4-8s |

**Edge window:** 15-30 seconds where we know the new fair value before other Kalshi participants adjust.

**Edge is largest:**
- Late-game scoring events (high leverage on probability)
- Momentum runs (compounding shifts)
- Overtime (every point is high-leverage)

**Edge is smallest:**
- Early game (score changes barely move fair value)
- Timeouts / halftime (no scoring)
- Pre-game (no score data)

---

## Error Handling & Staleness

**Staleness tracking:**

- Track `last_score_update_at` per game.
- If no successful poll in 10 seconds (3-4 missed cycles), mark fair value as stale → `SKIP` signal.
- A successful poll returning the same score resets the timer — data is fresh, just unchanged.

**API errors:**

- Rate limiting (429 / timeouts): Back off to 5s on that source, lean on fallback.
- Parse errors: Immediate failover, log for debugging.
- Game ID not found: Don't trade that game rather than guess.

---

## What Changes vs. What Stays

| Component | Current | Proposed |
|---|---|---|
| Data source (NBA) | The Odds API (20s poll) | NBA API + ESPN fallback (2-3s poll) |
| Fair value math | Devig sportsbook odds | Win probability table lookup |
| Velocity signal | Odds rate of change | Score differential rate of change |
| Config | `[odds_feed]` only | Add `[score_feed]` for NBA |

**Unchanged:** Kalshi REST/WS, market matching (extended), signal logic, fee calc, book pressure, risk controls, TUI, simulation mode, all non-NBA sports.

---

## File Structure

- `src/feed/score_feed.rs` — ScorePoller, NBA/ESPN API clients, failover logic
- `src/engine/win_prob.rs` — WinProbTable, static lookup data, overtime table
- `config.toml` — New `[score_feed]` section
- Wiring changes in main polling loop to dispatch NBA games to score feed
