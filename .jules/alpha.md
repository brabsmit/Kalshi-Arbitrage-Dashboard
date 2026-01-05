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

## 2024-05-22 - Time Decay (The Timer)

**Hypothesis:** As an event approaches its start time, market volatility and the risk of sudden line movement increase. We should demand a higher margin of safety (lower bid price) to compensate for this increased risk.

**Change:**
Old: `effectiveMargin = marginPercent + (volatility * 0.25)`
New: `effectiveMargin = marginPercent + (volatility * 0.25) + timePenalty`
Where `timePenalty` scales linearly from 0% at 1 hour out to 5% at 0 hours out.

**Expected Result:**
- Reduced exposure to last-minute volatility.
- Lower probability of holding a position through a sudden pre-game line shift.
- "Fade" the approach to game time by lowering bids automatically.
