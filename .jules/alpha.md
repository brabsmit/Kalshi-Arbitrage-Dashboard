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

## 2024-05-23 - The Timer (Time Decay Margin)

**Hypothesis:** As an event approaches execution, market volatility increases and the "time-to-react" (ability to cancel stale orders) decreases. Pre-game odds become stale faster. We must demand a higher margin of safety for events starting soon.

**Change:**
Added a `timePenalty` to the `effectiveMargin` calculation:
- If event starts in < 24 hours: +1% margin.
- If event starts in < 1 hour (or has started): +5% margin.

**Expected Result:**
- Lower max bid prices for events starting soon.
- Reduced exposure to "Gametime" volatility.
- Prevents the bot from aggressively bidding on events that are about to lock or go live.
