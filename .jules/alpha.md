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

## 2024-10-27 - The Timer (Time-to-Expiry Padding)

**Hypothesis:** As an event approaches its start time, pre-match odds become "toxic" (stale) more quickly, and volatility spikes due to late-breaking news (lineups, weather). Also, betting on pre-match odds after the game starts is a guaranteed loss (adverse selection vs live feeds).

**Change:**
Old: Constant margin regardless of time.
New:
- If `Time < 1 hour`: `margin = margin * 1.5`.
- If `Time <= 0` (Started): Stop trading (`maxWillingToPay = 0`).

**Expected Result:**
- Zero exposure to active games (preventing accidental live betting with pre-match logic).
- Higher safety buffer in the final hour before kickoff.
- Reduced "sniper" risk from sharp traders reacting to lineup news faster than our 15s poll.
