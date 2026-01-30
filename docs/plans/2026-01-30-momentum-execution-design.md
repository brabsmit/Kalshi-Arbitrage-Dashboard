# Momentum-Aware Execution Engine

## Problem

The arbitrage engine detects when Kalshi prices diverge from devigged fair value, but edge alone is insufficient to trigger orders. Kalshi markets can sit below fair value for extended periods. Placing open bids on edge alone risks long-term exposure with no fill guarantee. Orders should only be placed when there is evidence the market is about to move toward fair value.

## Solution

Add a momentum scoring layer between signal detection and order execution. Two sub-signals (sportsbook odds velocity and Kalshi orderbook pressure) combine into a composite score that determines whether and how aggressively to execute.

## Design

### 1. Momentum Signal Architecture

Two sub-signals combine into a composite momentum score per event.

#### Sportsbook Velocity Signal

- Maintain a rolling window of the last N odds snapshots per event (configurable, default 5-10).
- Each snapshot is timestamped on arrival.
- On new snapshot:
  - If implied probability is identical to previous snapshot, the odds-api cache hasn't refreshed. Score this as 0 (unknown), not as "stable." Do not include stale-duplicate snapshots in velocity calculations.
  - If changed, compute `delta_implied_prob / delta_time` as velocity (points per minute).
  - Example: line moves from -150 (60.0%) to -180 (64.3%) across two polls 20s apart = +12.9 points/min.
- Normalize to a 0-100 score based on configurable scaling parameters.

#### Orderbook Pressure Signal

- Track Kalshi orderbook depth on both sides from existing WebSocket deltas.
- Compute a pressure ratio using depth within a configurable band near the touch (default 3-5 cents of best bid/ask): `bid_depth_near_touch / ask_depth_near_touch`.
- Rising bid depth + thinning asks = buy-side pressure.
- Track the rate of change of this ratio across recent snapshots (seconds-scale).
- Normalize to 0-100.

#### Composite Momentum Score

- Weighted combination: `velocity_weight * velocity_score + book_pressure_weight * book_pressure_score`.
- Weights configurable, default 0.6 velocity / 0.4 book pressure.
- Score range: 0-100.

### 2. Tiered Execution Logic

The composite score determines execution behavior. Evaluated only when a fair-value edge already exists (existing `taker_edge_threshold` / `maker_edge_threshold` logic).

#### No Action (score < maker_momentum_threshold)

- Edge exists but no momentum backing it.
- No order placed.
- Log as "edge without momentum" for analysis.
- This is the key behavioral change: edge alone no longer triggers orders.

#### Maker Bid (score >= maker_momentum_threshold, < taker_momentum_threshold)

- Moderate momentum. Market is likely moving but not urgently.
- Place a maker bid at `best_bid + 1` (existing maker logic).
- Start auto-cancel monitor (see section 3).

#### Taker Buy (score >= taker_momentum_threshold)

- Strong momentum. Sportsbook lines moving fast, Kalshi book thinning.
- Buy at the ask immediately. Taker fees apply but fill is instant.
- No cancel logic needed.

### 3. Auto-Cancel on Signal Decay

When a maker bid is placed, the system monitors the momentum score at a configurable interval (default 100ms):

- If momentum score drops below `cancel_threshold` before the order fills, cancel the order immediately.
- `cancel_threshold` is set below `maker_momentum_threshold` to avoid flapping (e.g., maker triggers at 40, cancel at 30).
- On fill confirmation (via WebSocket or REST polling), stop monitoring.

### 4. Adaptive Odds Polling

#### Per-Sport Scheduling

Not all events need the same polling frequency. Use `commence_time` to determine game state:

- **Pre-game** (commence_time in the future): Poll at 120s intervals. The-odds-api documents non-live latency as up to 120 seconds; faster polling is wasteful.
- **Live** (commence_time in the past, game not yet settled): Poll at 20s intervals. The-odds-api documents live latency as under 40 seconds; 20s polls catch most updates within one extra cycle.
- **Settled/Closed**: Stop polling.

Since the-odds-api returns all events for a sport in one request, the poll interval for a sport is determined by whether *any* event in that sport is live. If yes, 20s. If no, 120s. This maximizes quota savings.

#### API Quota Tracking

- Read `requests_used` and `requests_remaining` from API response headers.
- Compute `burn_rate` (requests per hour at current mix of live/pre-game sports).
- Compute `hours_remaining` at current burn rate.
- If remaining quota drops below a configurable warning threshold, automatically back off all sports to 120s polling.

### 5. TUI Changes

#### API Usage Panel

Add a status area to the dashboard:

- Requests used / remaining (quota).
- Current effective poll interval per sport.
- Burn rate (requests/hour).
- Estimated hours until quota exhaustion.
- Visual warning (color change) when quota is low.

#### Momentum Column & Sorting

- Add a `Momentum` column to the live markets table showing the composite score.
- Change primary sort to **momentum score descending**, with edge as tiebreaker.
- Actionable opportunities (edge + momentum) surface to the top; stale edges sink.

## Configuration

New `[momentum]` section in `config.toml`:

```toml
[momentum]
maker_momentum_threshold = 40       # Min score to place maker bid
taker_momentum_threshold = 75       # Min score to taker buy at ask
cancel_threshold = 30               # Cancel unfilled maker orders below this
velocity_weight = 0.6               # Weight of sportsbook velocity in composite
book_pressure_weight = 0.4          # Weight of orderbook pressure in composite
cancel_check_interval_ms = 100      # How often to re-evaluate momentum for open orders
velocity_window_size = 10           # Number of snapshots in rolling window

[odds_feed]
live_poll_interval_s = 20           # Poll interval for sports with live games
pre_game_poll_interval_s = 120      # Poll interval for sports with no live games
quota_warning_threshold = 100       # Back off polling when remaining requests below this
```

## Data Flow

```
Odds API (20s/120s)          Kalshi WebSocket (realtime)
       |                              |
  timestamp + store              orderbook deltas
       |                              |
  velocity signal              pressure signal
       |                              |
       +-------> Composite Score <----+
                      |
              Existing Edge Check
                      |
            +---------+---------+
            |         |         |
          Skip    Maker Bid   Taker Buy
                    |
              Cancel Monitor
              (100ms checks)
                    |
            +-------+-------+
            |               |
      Score < 30:      Fill confirmed:
      Cancel order     Stop monitoring
```

## Summary of Changes

1. **Momentum scoring** -- sportsbook velocity + orderbook pressure into composite 0-100 score.
2. **Tiered execution** -- score determines skip / maker bid / taker buy.
3. **Auto-cancel** -- unfilled maker orders canceled when momentum decays below threshold.
4. **Adaptive polling** -- 20s for live sports, 120s for pre-game, with automatic backoff on low API quota.
5. **TUI enhancements** -- API usage panel, momentum column, momentum-descending sort order.
