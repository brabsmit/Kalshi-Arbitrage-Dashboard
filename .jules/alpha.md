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

## 2024-05-23 - The Timer (Time-Decay Margin)

**Hypothesis:** As the event start time approaches (within 1 hour), volatility increases and "pre-match" odds become less reliable as sharps shape the final line. We should increase our margin of safety to avoid being on the wrong side of late money.

**Change:**
Old: `margin = effectiveMargin`
New: If `hoursUntilGame < 1`, `margin = effectiveMargin + (1 - hoursUntilGame) * 5`.
(Linearly adds up to 5% extra margin as time hits zero).

**Expected Result:**
- Lower risk in the final hour before kickoff.
- Avoids "picking up pennies" in front of the steamroller of sharp late money.
