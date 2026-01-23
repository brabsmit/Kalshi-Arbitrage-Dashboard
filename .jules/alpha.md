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

## 2026-01-24 - The Timer (Time Decay Risk Adjustment)

**Hypothesis:** As an event approaches its start time ("commence time"), volatility increases due to late-breaking news (injuries, lineup changes, weather). The risk of adverse selection increases significantly in the final hours. We need to widen our margin of safety to account for this uncertainty.

**Change:**
Old: `margin = marginPercent` (Constant)
New:
- If `hoursUntilCommence < 1`: `margin = marginPercent * 1.5`
- If `hoursUntilCommence < 6`: `margin = marginPercent * 1.25`
- Else: `margin = marginPercent`

**Expected Result:**
- Lower fill rate on games starting soon (avoiding "trap" bets).
- Protection against last-minute line movements.
- Higher expected value on filled trades by demanding a larger edge during high-risk windows.
