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

## 2024-05-23 - The Timer (Time-Decay Risk Adjustment)

**Hypothesis:** As an event approaches commencement (Game Start), the risk of adverse selection increases significantly due to:
1.  **Stale Odds:** Provider feeds may lag behind real-time sharp books.
2.  **Liquidity Risk:** Exiting a position becomes harder if the market moves against us right before lock.
3.  **Volatility:** Prices swing violently in the final hour.

**Change:**
Old: Margin is constant regardless of time.
New:
- If `Time < 12h`: Add +1% to margin.
- If `Time < 1h`: Add +5% to margin (Panic Mode).
- If `Time <= 0`: **HALT TRADING** (Return null bid).

**Expected Result:**
- **Zero** trades executed after the game starts (Safety Halt).
- significantly more conservative bidding in the final hour ("Panic Mode").
- Reduced "bag holding" of positions that cannot be exited before the event starts.
