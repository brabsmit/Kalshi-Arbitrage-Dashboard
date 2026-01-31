# Edge Priority Review: Kalshi Arbitrage Strategy

**Date:** 2026-01-31
**Status:** Design
**Goal:** Prioritize improvements to the kalshi-arb engine by edge-per-effort, focused on proving strategy viability in simulation mode before implementing live order placement.

## Strategy Summary

Beat human reaction speed on Kalshi by computing a game's fair value from low-latency score updates, converting scores to win probabilities, bidding on undervalued contracts, and selling for a profit as the market converges to fair value.

## Current Architecture

```
Score Feed (3s poll) ──> Win Prob Model ──> Fair Value (cents)
                                                  │
Kalshi WS (real-time) ──> DepthBook ──> Best Bid/Ask
                                                  │
                                           Strategy Eval
                                           (edge + fees)
                                                  │
                                         Momentum Gate ──> Signal
                                                  │
                                         Sim Fill / Log
```

**End-to-end latency:** 3-5 seconds (dominated by score feed polling).
**Internal compute:** <1ms (model + strategy + momentum).

---

## Priority 1: Simulation Fill Realism

**Problem:** Sim P&L is overstated due to two unrealistic assumptions.

### A. Instant entry fills at `best_ask`

The sim immediately fills TakerBuy signals at the current `best_ask`. In reality, 3+ seconds have elapsed since the score event — the ask has likely already moved toward fair value. The sim credits you with a price that wouldn't exist by the time a real order reached Kalshi.

### B. Exit at `fair_value`

The sim sets `sell_price = fair_value` and fills when `yes_bid >= sell_price`. But fair value is the model's estimate, not a guaranteed convergence target. In volatile games, fair value shifts before the exit fills.

### Fix

1. **Add configurable `simulated_latency_ms`** (default: 500ms). On signal, snapshot the current orderbook. After the latency delay, re-read the orderbook and fill at the *then-current* `best_ask`. If the ask has moved past fair value, the trade is skipped.

2. **Track slippage**: log `signal_time_ask - fill_time_ask` per trade. This is the core metric for whether speed improvements (P2) are paying off.

3. **Exit at `break_even_sell_price`** (already implemented in `fees.rs`) instead of `fair_value`. Proves you can exit profitably, not just that the model is directionally correct.

4. **Add fill probability for maker orders**: MakerBuy posts at `best_bid + 1`. Sim should only fill if the orderbook subsequently shows trades at or through that price, not instantly.

**Effort:** Small (main.rs sim logic, ~50-100 lines).
**Impact:** Without this, all other improvements are evaluated against unreliable sim data.

---

## Priority 2: Score Feed Latency

**Problem:** 3-second NBA polling interval is the latency ceiling. Average delay from score event to evaluation is ~1.5 seconds. The Kalshi orderbook begins moving within seconds of a score change.

### Staged approach

#### Immediate: reduce poll interval to 1s

Single config change. 3x faster reaction. Check that NBA/ESPN APIs don't rate-limit at this frequency (ESPN public endpoints are generally tolerant; NBA CDN endpoint `cdn.nba.com/static/json/liveData/` updates sub-second and has no auth).

#### Short-term: switch to NBA CDN live endpoint

`https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json` is a static JSON file that updates every ~1-2 seconds. It's served from CDN with no rate limiting. Conditional GET with `If-Modified-Since` or `ETag` headers avoids bandwidth waste when unchanged.

#### Medium-term: investigate push-based feeds

ESPN has undocumented Server-Sent Events endpoints used by their live scoreboard. Several open-source projects have documented these. A push-based feed would reduce latency to <500ms from score event.

Alternatively, paid feeds (Sportradar, Action Network) offer WebSocket-based score updates with <200ms latency. Cost-justified only after proving sim profitability.

**Effort:** Trivial (config) → Medium (CDN endpoint) → Medium (push feed).
**Impact:** Every 100ms reduction in score latency directly widens the window where Kalshi hasn't priced in the score change.

---

## Priority 3: Win Probability Model Calibration

**Problem:** The logistic model has uncalibrated parameters that could introduce systematic bias of 2-5 cents — enough to generate false signals or suppress real ones.

### A. Home court advantage is stale

`HOME_ADVANTAGE = 3.0` implies ~57-58% home win rate. Current NBA season is closer to 54-55%. Overvaluing home teams by 1-2 cents on every evaluation.

**Fix:** Reduce to 2.0-2.5 based on current season data. Make configurable in `config.toml`.

### B. k-curve is uncalibrated

The cubic ramp from 0.065 to 0.315 determines how quickly score leads become decisive. Without fitting against historical play-by-play outcomes, the curve shape is intuition-based.

**Fix:** Download NBA play-by-play data (freely available from `pbpstats.com` or `stats.nba.com`). For each score-time-diff triple, record whether home won. Fit k(t) to minimize log-loss against actual outcomes. This is a one-time offline analysis that produces better constants.

### C. No possession/timeout adjustment in final minutes

A 3-point lead with possession and 30 seconds left is ~95%. A 3-point deficit with possession and 30 seconds left is ~25%. The model gives both ~85% / ~15% (just flipped sign). In the final 2-3 minutes, where k is steepest and Kalshi markets are most volatile, this creates the largest model errors at exactly the highest-leverage moments.

**Fix (later):** Add possession indicator from score feed. Only matters for final ~3 minutes. ESPN data includes possession info in some game states.

**Effort:** Low (home advantage) → Medium (k-curve fitting) → Medium (possession).
**Impact:** Eliminates systematic bias at the price levels where you're actually trading.

---

## Priority 4: Momentum Gating Bypass for Score Signals

**Problem:** Momentum gating may be actively suppressing your best score-based signals.

The velocity tracker measures sportsbook odds movement. But for score-derived signals, your edge comes from knowing the score *before* the sportsbooks update. High velocity means sportsbooks are catching up — which means Kalshi is likely catching up too and your window is closing.

For score-based signals, the momentum gate requires the sportsbooks to confirm what you already know from the score feed, adding delay to a strategy whose entire edge is speed.

### Fix

1. **Add `bypass_momentum_for_score_signals` config flag.** When true, score-feed-derived signals skip `momentum_gate()` entirely.

2. **Log momentum scores alongside sim outcomes.** After accumulating data, plot sim P&L vs momentum score at signal time. This empirically determines whether momentum gating helps or hurts score signals.

3. **Keep momentum gating for odds-derived signals.** Those benefit from confirmation since you're not faster than the sportsbooks — you're aggregating them.

**Effort:** Small (~10 lines in main.rs + config).
**Impact:** Potentially unlocks a class of profitable trades currently being filtered out.

---

## Priority 5: College Basketball Score Model

**Problem:** Only NBA has a score-based fair value pipeline. The other 7 sports use 20-second sportsbook odds polling with zero speed advantage.

### Why college basketball first

- **Matcher already supports it** (recent commit expanded mascot coverage for college basketball).
- **Same logistic model structure** as NBA — adjust parameters, not architecture.
- **Hundreds of games per day** during season — far more surface area than NBA's ~5-10 nightly games.
- **ESPN has the same API format** for college scores as NBA.
- **Kalshi lists college basketball markets** across men's and women's.

### Parameter differences from NBA

| Parameter | NBA | College Basketball |
|-----------|-----|-------------------|
| Home advantage | 2.0-2.5 pts | 3.5-4.0 pts (stronger in college) |
| Period structure | 4 x 12min | 2 x 20min |
| Total regulation | 2880s | 2400s |
| k range | 0.065 → 0.315 | Needs fitting (more variance, longer possessions) |
| OT structure | 5min periods | 5min periods (same) |

### Implementation

1. Add `college_basketball` variant to `WinProbTable` with adjusted constants.
2. Add ESPN college basketball score endpoint to `score_feed.rs`.
3. Update `compute_elapsed()` for 2x20min half structure.
4. Wire into existing `process_score_updates()` pipeline.

**Effort:** Medium (~200 lines: model variant + feed endpoint + elapsed calc).
**Impact:** Doubles or triples the number of markets where you have a speed edge.

---

## Future Priorities (post-simulation validation)

These become relevant once sim results prove consistent profitability:

- **NFL win probability model** — highest Kalshi volume, well-studied models available from nflfastR, but requires possession/down/distance state. Build before 2026 season.
- **Order placement pipeline** — REST integration already stubbed in `rest.rs`. Needs risk manager activation, position sizing, fill monitoring, and orphan cleanup.
- **Orderbook depth improvements** — `DepthBook::best_bid_ask()` iterates all price levels. Replace `HashMap<u32, i64>` with a sorted structure (BTreeMap) for O(1) best price access. Only matters at scale with deep books.
- **Allocation reduction in hot path** — pre-allocate `accumulated_rows` HashMap, reuse team name strings. Negligible impact vs polling interval but good hygiene.

---

## Success Metrics (Simulation)

Before moving to live trading, the simulation should demonstrate:

1. **Positive expected value per trade** after realistic latency simulation and slippage
2. **Slippage < 2 cents** on average (proves speed edge exists)
3. **Win rate > 55%** on closed sim positions (proves model accuracy)
4. **Sharpe > 1.0** on sim P&L curve over 100+ trades (proves consistency)
5. **No systematic bias** — home/away, early/late game, and high/low fair value trades should all be profitable (proves model isn't leaking edge in one direction)
