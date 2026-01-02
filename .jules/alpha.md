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

## 2026-01-02 - The Timer (Gamma Risk Adjustment)

**Hypothesis:** As an event approaches its start time (or goes live), volatility ("Gamma") increases significantly. Odds can shift rapidly, making a static margin dangerous. We should demand a larger margin of safety as time-to-start decreases.

**Change:**
Old: `margin = config.marginPercent + (volatility * 0.25)`
New: `margin = config.marginPercent + (volatility * 0.25) + timePenalty`
Where `timePenalty` is a linear ramp from 0% (1 hour out) to 5% (Start time), capped at 5%.

**Expected Result:**
- Lower bids (lower MaxWillingToPay) as the game approaches.
- Protection against "sniping" where we buy a stale price right before a major line move.
- Better risk/reward profile for high-uncertainty periods (pre-game).
