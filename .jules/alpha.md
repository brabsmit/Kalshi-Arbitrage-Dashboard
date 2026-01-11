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

## 2026-01-11 - The Timer (Time-Decay Margin)

**Hypothesis:** As an event approaches its start time, "unknown unknowns" (injuries, lineup changes, sharp money) increase the risk of adverse selection. Our static margin doesn't account for this heightened volatility near kickoff.

**Change:**
Old: `margin = base_margin + vol_padding`
New:
- If < 24h to start: `margin += 1%`
- If < 1h to start: `margin += 5%`

**Expected Result:**
- Reduced exposure to pre-game volatility spikes.
- Lower probability of being "picked off" by informed traders reacting to late breaking news before our odds feed updates.
- Slightly lower fill rate on game day, but higher quality fills.
