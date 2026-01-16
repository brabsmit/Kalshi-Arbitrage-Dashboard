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

## 2026-01-16 - The Timer (Time-Decay Margin)

**Hypothesis:** As the event start time approaches, market efficiency increases (lines become "sharper") and the risk of adverse selection from informed traders increases. A static margin might be sufficient for a game 2 days away (where lines are loose), but insufficient for a game starting in 10 minutes (where lines are tight and efficient).

**Change:**
Old: `effectiveMargin = marginPercent`
New: `effectiveMargin = marginPercent * timeMultiplier`
- If < 1 hour: 1.5x Margin
- If < 24 hours: 1.1x Margin
- Else: 1.0x Margin

**Expected Result:**
- Reduced fill rate on events starting soon (avoiding "picking up pennies in front of a steamroller").
- Higher confidence in trades taken close to kick-off (requires a massive edge to trigger).
- Better protection against late-breaking news or lineup changes.
