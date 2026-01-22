# Alpha Strategy Log

This file tracks the evolution of the trading strategy.

## 2026-01-22 - The Timer (Time-Based Margin)

**Hypothesis:** As an event approaches commencement (game time), volatility and risk increase due to late-breaking news (injuries, lineup changes) and sharp money moves. A static fair value derived hours ago is dangerous.

**Change:**
Implemented dynamic margin multipliers based on time-to-start:
- If `hoursUntilGame < 1`: Multiply margin by **1.5x**.
- If `hoursUntilGame < 6`: Multiply margin by **1.25x**.
- Else: Use base margin (1.0x).

**Expected Result:**
- Lower bid prices (higher safety margin) for imminent games.
- Reduced risk of getting "run over" by late price moves.
- Preservation of capital during high-volatility windows.

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
