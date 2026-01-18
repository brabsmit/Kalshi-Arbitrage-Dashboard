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

**Hypothesis:** As an event approaches execution (Game Time), volatility increases and the "time to recovery" for a bad trade drops to zero. A position bought 10 minutes before kickoff is riskier than one bought 2 days prior because there is no time to exit if the line moves against us.

**Change:**
Old: `margin = config.marginPercent` (constant).
New:
- If `hoursUntilStart < 1`: `margin = margin * 1.5`
- If `hoursUntilStart < 24`: `margin = margin * 1.1`
- Else: `margin = margin`

**Expected Result:**
- Reduced risk exposure on imminent events.
- Prevents the bot from providing liquidity during pre-game chaotic repricing.
- Protects capital by demanding a higher "Margin of Safety" when uncertainty is highest.
