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

## 2026-01-25 - Dynamic Fee Protection

**Hypothesis:** The static 1¢ fee buffer was underestimating costs for contracts priced near 50¢ (where fees are ~1.75¢), leading to negative EV trades when crossing the spread.

**Change:**
Old: `buffer = 1`
New: `buffer = calculateKalshiFees(bestAsk, 1)`

**Expected Result:**
- Eliminates "Fake Edge" trades where fees consume the entire profit margin.
- Maintains aggressive behavior on cheap/expensive contracts (where fees are low) while protecting the mid-curve.
