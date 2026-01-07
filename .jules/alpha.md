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

## 2024-05-22 - The Timer (Time Decay Margin)

**Hypothesis:** As an event approaches its start time (or "commence time"), uncertainty increases due to potential last-minute news (injuries, weather, lineup changes) and increased market volatility. A fixed margin is unsafe in the final minutes before kickoff.

**Change:**
Old: `effectiveMargin` only accounted for historical volatility.
New: Added a linear time penalty in the final 60 minutes before start.
`timePenalty = MAX_TIME_PENALTY * (1 - hoursRemaining)` where `MAX_TIME_PENALTY = 5%`.
This is added to the `effectiveMargin`.

**Expected Result:**
- Lower bids (or no bids) immediately before game start.
- Protection against "gametime decision" adverse selection.
- Reduced exposure to frantic pre-game price swings.
