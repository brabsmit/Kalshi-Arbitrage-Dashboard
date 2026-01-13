# Alpha Strategy Log

This file tracks the evolution of the trading strategy.

## 2024-05-22 - Dynamic Volatility Padding

**Hypothesis:** High volatility in source odds indicates uncertainty or rapid repricing. We should widen our margin to avoid buying a "falling knife" or "rising rocket" at a stale price.

**Change:**
Old: `margin = config.marginPercent`
New: `margin = config.marginPercent + (market.volatility || 0)`

**Expected Result:**
- Reduced fill rate on high-volatility markets (which is good).
- Lower risk of adverse selection (getting filled right before price moves against us).
- Better "smart bid" placement in turbulent markets.

## 2024-05-22 - Crossing the Spread (Liquidity Taking)

**Hypothesis:** Bidding "Penny Up" (Best Bid + 1) misses guaranteed profits when the Best Ask is already significantly below our Fair Value. By switching from Maker to Taker when the edge is deep, we secure the fill immediately.

**Change:**
Old: Always set `smartBid = bestBid + 1`.
New: If `bestAsk <= maxWillingToPay - 2¢` (buffer for fees), set `smartBid = bestAsk`.

**Expected Result:**
- Higher fill rate on high-edge opportunities.
- Captures value immediately instead of waiting for a seller to cross the spread.
- Accepts Taker fees (approx 1-2¢) in exchange for guaranteed execution.

## 2024-05-22 - The Timer (Time-Decay Margin)

**Hypothesis:** As an event approaches commencement (`commenceTime`), two risks increase:
1.  **Stale Data:** A 30-second delay is fatal when the game starts in 2 minutes.
2.  **Volatility:** Prices swing wildly near the open.
We need to demand a higher margin of safety ("pay less") for imminent events to compensate for this risk.

**Change:**
Added a `timePenalty` to `effectiveMargin`:
- If `hoursRemaining < 1`: **+5% Margin** (Aggressive safety).
- If `hoursRemaining < 24`: **+1% Margin** (Standard decay).
- Else: **+0%** (Long-term holds are safer from latency).

**Expected Result:**
- Lower bids on games starting soon.
- Reduced exposure to "latency arbitrage" where we bid on old odds while the game has already started.
