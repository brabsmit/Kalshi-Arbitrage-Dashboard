# Strategy Alignment Review: Kalshi Arbitrage Dashboard

**Date:** 2026-01-14
**Reviewer:** Claude (Strategic Code Analysis)
**Purpose:** Identify where implementation has diverged from stated core strategy

---

## Executive Summary

The Kalshi Arbitrage Dashboard has experienced **significant feature creep** that obscures and potentially undermines its core statistical arbitrage strategy. While the stated strategy is elegantly simple—buy Kalshi contracts below fair value, sell at fair value—the implementation has accumulated complexity that introduces strategic contradictions, unnecessary costs, and maintenance burdens.

**Key Finding:** Several "alpha strategies" actually work *against* the core arbitrage logic, and extensive UI features provide analytics without improving execution.

---

## Core Strategy (As Documented)

From `strategy.md`, the core strategy is:

1. **Calculate Fair Value:** Vig-free probability from multiple sportsbooks
2. **Enter Position:** Buy on Kalshi when price < (Fair Value - Margin)
3. **Exit Position:** Sell at Fair Value (or break-even if higher)
4. **Risk Management:** Position limits, staleness detection, avoid adverse selection

**Strategic Philosophy:** Patient, maker-side statistical arbitrage with disciplined margin protection.

---

## Critical Pitfalls Identified

### 1. ⚠️ **VOLATILITY PADDING: BACKWARDS LOGIC**

**Location:** `src/utils/core.js:68-78`

**The Problem:**
```javascript
// Alpha Strategy: Dynamic Volatility Padding
const volatility = market.volatility || 0;
const effectiveMargin = marginPercent + (volatility * 0.25);
```

**What It Does:**
- Increases required margin when source odds volatility is high
- Reduces position size or skips opportunities during volatile periods
- Rationale: "protects against adverse selection during rapid repricing"

**Why This Is Wrong:**

In sports betting arbitrage, **high volatility = opportunity, not risk**.

- **Breaking News:** Injury reports, weather changes, lineup announcements create pricing discrepancies
- **Mispricing Window:** Books update at different speeds, creating temporary arbitrage
- **Best Edge:** The highest-edge opportunities occur precisely during volatility spikes
- **False Analogy:** Unlike financial markets, sports betting odds don't have "momentum" that persists

**Real-World Example:**
```
Scenario: Star quarterback injury announced
- FanDuel: Updates odds in 30 seconds
- DraftKings: Updates in 2 minutes
- Kalshi: Updates in 5 minutes (manual market maker)

Current System: Sees volatility spike → increases margin → MISSES THE TRADE
Correct Behavior: Sees volatility → THIS IS THE EDGE → takes the trade
```

**Impact:**
- 🔴 Missing the highest-edge opportunities
- 🔴 Reducing returns when they should be maximized
- 🔴 Contradicts stated strategy of exploiting mispricing

**Recommendation:**
- **REMOVE** volatility padding entirely, OR
- **INVERT** the logic: reduce margin during high volatility (when edge is clear)
- Consider: Volatility might indicate *data quality* (more books agreeing = higher vol), not risk

---

### 2. ⚠️ **CROSSING THE SPREAD: FEE EROSION**

**Location:** `src/utils/core.js:87-98`

**The Problem:**
```javascript
// Alpha Strategy: Crossing the Spread
const TAKER_FEE_BUFFER = 0;  // UPDATED: Set to 0 to chase hard

if (market.bestAsk <= (maxWillingToPay - TAKER_FEE_BUFFER)) {
    smartBid = market.bestAsk;
    reason = "Take Ask";
}
```

**What It Does:**
- Switches from maker (bid + 1¢) to taker (hit the ask) when ask is below max willing to pay
- Buffer reduced to 0 cents to "chase aggressively for small arbitrage"

**Why This Is Problematic:**

**Kalshi Taker Fees:** ~7% of payout (e.g., buying at 50¢ costs ~1.75¢ in fees)

**Math Example:**
```
Fair Value: 52¢
Best Ask: 50¢
Apparent Edge: 2¢

With Taker Fee:
Fee = ceil(0.07 * 10 * 0.50 * 0.50) = ceil(0.175) = 1¢ per contract
Real Edge: 2¢ - 1¢ = 1¢ profit

If Best Ask was 51¢:
Fee = 1¢
Real Edge: 1¢ - 1¢ = 0¢ (BREAK EVEN!)
```

**With TAKER_FEE_BUFFER = 0:**
- System will take liquidity even on 1¢ edges
- After fees, these trades are break-even or losers
- Increases fill rate but *decreases profitability*

**Strategic Contradiction:**
- Stated strategy: "patient maker-side arbitrage"
- Implementation: aggressive taker with 0 buffer
- **Result:** Paying for speed when sports betting doesn't require speed (games are hours away)

**Impact:**
- 🔴 Eroding profit margins on small-edge opportunities
- 🔴 Contradicts cost-conscious maker strategy
- 🔴 Optimizing for fill rate instead of profitability

**Recommendation:**
- **SET MINIMUM BUFFER:** At least 2¢ to cover typical taker fees
- **CALCULATE FEE-AWARE EDGE:** Only cross spread when `edge > estimated_taker_fee + min_profit`
- **QUESTION THE PREMISE:** Do we really need to take liquidity in pre-game betting? (vs live in-game)

---

### 3. ⚠️ **AUTO-CLOSE STRATEGY: CONFIGURATION CONFUSION**

**Location:** `strategy.md:119-120` and `runAutoClose` implementation

**The Problem:**

**Strategy Doc Says:**
> "While a `config.autoCloseMarginPercent` exists in the Settings UI, the current implementation strictly follows the **Fair Value** (plus/minus 0 margin) for exits"

**What Actually Happens:**
```javascript
// Exit price = max(Fair Value, Break-Even)
const targetPrice = Math.max(
    market.fairValue,
    calculateBreakEven(pos.costBasis, estimatedFees)
);
```

**Issues:**

1. **Configuration Ignored:** UI shows `autoCloseMarginPercent` setting but it's not used
2. **Inconsistent Documentation:** "Fair Value + 0%" vs "greater of FV or break-even"
3. **Unclear Strategy:** Is the goal to capture full probability value or just minimize losses?

**Strategic Questions:**

- **Why sell at Fair Value?** If Fair Value represents true probability, selling at FV is break-even EV
- **Where's the profit?** Profit only comes from entry (buying below FV) → but exit at FV locks in entry edge
- **What about margin targets?** Many traders use entry at FV-3% and exit at FV+2% to capture 5% edge

**Current Behavior:**
```
Buy at: 47¢ (Fair Value 50¢ - 3¢ margin)
Sell at: 50¢ (Fair Value)
Profit: 3¢ per contract ✓

But if Fair Value drops to 48¢:
Sell at: 48¢ (new Fair Value)
Profit: 1¢ per contract ⚠️ (gave back 2¢)
```

**Impact:**
- 🟡 Unclear profit targets
- 🟡 Configuration UI misleads users
- 🟡 Potential to exit too early or give back gains

**Recommendation:**
- **CLARIFY STRATEGY:** Document whether exits should be FV+margin or just FV
- **IMPLEMENT OR REMOVE:** Either use `autoCloseMarginPercent` or remove it from UI
- **CONSIDER:** Exit at FV+1% to capture momentum and avoid immediate repricing losses

---

### 4. ⚠️ **TURBO MODE: UNJUSTIFIED COST**

**Location:** `strategy.md:28-29`

**The Problem:**

**Normal Mode:** 15-second polling
**Turbo Mode:** 3-second polling (5x frequency)

**Questions:**

1. **Why is this needed?** Sports games are hours away; odds don't change second-to-second
2. **What's the ROI?** Does 5x polling frequency produce 5x more filled orders or better prices?
3. **API Cost:** Burns through API quota 5x faster (The Odds API charges per request)
4. **Adverse Selection:** Faster polling might *increase* adverse selection if you're the first to bid on stale Kalshi prices that are about to update

**Real-World Timeline:**
```
Scenario: News breaks about player injury

T+0 sec: Twitter announces injury
T+30 sec: Sharp bettors hit sportsbooks
T+60 sec: Sportsbooks adjust odds
T+75 sec: The Odds API updates (their poll cycle)
T+90 sec: Your system fetches new odds
T+91 sec: You bid on Kalshi

Kalshi Update Timeline:
T+120 sec: Kalshi market maker sees new consensus
T+150 sec: Kalshi updates market prices

Window: You have ~60 seconds to get filled before Kalshi updates
```

**Does 3-second vs 15-second polling matter in this window?**

- Probably not—the bottleneck is The Odds API update cycle (typically 30-60 seconds)
- You're still waiting for *their* data, so polling faster just fetches the same data repeatedly

**Impact:**
- 🟡 Increased API costs (5x request volume)
- 🟡 No documented performance improvement
- 🟡 Potential for "thrashing" (repeatedly placing same orders)

**Recommendation:**
- **MEASURE BENEFIT:** A/B test 15s vs 3s polling to measure fill rate and edge capture
- **CONSIDER:** Use WebSocket for Kalshi (already implemented) and keep Odds API at 15s
- **OPTIMIZE:** Only increase polling frequency during live games (when odds actually move fast)

---

### 5. ⚠️ **FEATURE CREEP: 3,016-LINE MONOLITH**

**Location:** `src/App.jsx` (3,016 lines)

**The Problem:**

The main application component contains:
- All UI components (Header, Market Scanner, Portfolio, Modals)
- All bot logic (Auto-Bid, Auto-Close, order management)
- All state management (markets, positions, orders, config)
- All API integration (REST, WebSocket)
- All business logic (strategy calculation, matching, fees)

**Symptoms of Feature Creep:**

1. **Statistics Banner:** Win Rate, T-Statistic, Realized PnL
   - Backwards-looking analytics
   - Don't inform forward strategy decisions
   - Nice-to-have, not need-to-have

2. **Extensive Sorting/Filtering:**
   - Sort by 7 different columns
   - Filter by sport, date, fair value threshold
   - Multi-select toggles
   - **Question:** Does this improve execution or just feel good?

3. **Multiple Modals:**
   - Analysis Modal (deep dive into trades)
   - Position Details Modal
   - Export Modal (CSV download)
   - Schedule Modal (time-based trading)
   - Settings Modal
   - **Observation:** 5 modals for a dashboard suggests complexity creep

4. **Session Reporting:**
   - CSV export
   - Detailed trade history
   - Performance metrics
   - **Reality Check:** This is useful for post-mortem, but doesn't make the strategy better

**Maintenance Impact:**

- 🔴 **Impossible to reason about:** 3K-line file exceeds human working memory
- 🔴 **Bug risk:** State dependencies create subtle race conditions
- 🔴 **Testing difficulty:** Can't unit test bot logic separately from UI
- 🔴 **Collaboration blocker:** Multiple devs can't work on same file
- 🔴 **Performance:** Re-renders entire app on any state change

**Strategic Impact:**

- 🟡 **Distraction:** Time spent on UI polish instead of strategy refinement
- 🟡 **Unclear priorities:** Hard to distinguish core features from nice-to-haves
- 🟡 **Technical debt:** Future changes become increasingly expensive

**Recommendation:**

**CRITICAL: Refactor into separate concerns:**

```
/src
  /components
    Header.jsx
    MarketScanner.jsx
    Portfolio.jsx
    StatsBanner.jsx
    /modals
      SettingsModal.jsx
      ExportModal.jsx
      ...
  /bot
    autoBid.js        ← Extract bot logic
    autoClose.js
    orderManager.js
  /hooks
    useMarketData.js  ← Extract data fetching
    usePortfolio.js
    useWebSocket.js
  /utils
    core.js           ← Already exists ✓
    kalshiMatching.js ← Already exists ✓
  App.jsx             ← Orchestration only (~200 lines)
```

**Priority:** High - This is the foundation for all other improvements

---

### 6. ⚠️ **WEBSOCKET COMPLEXITY: OVER-ENGINEERING?**

**Location:** Strategy Doc mentions WebSocket with 15s freshness threshold

**The Problem:**

**Architecture:**
- REST API polling every 15 seconds
- WebSocket connection for real-time updates
- Freshness tracking (prefer WS if < 15s old, else REST)
- Subscription management (add/remove tickers dynamically)

**Complexity Cost:**
- Dual data sources require reconciliation logic
- Freshness tracking adds state management overhead
- Connection management (reconnect, error handling)
- ~200 lines of WebSocket code

**Strategic Question:**

**For pre-game betting, does sub-15-second price updates matter?**

```
Game Time: 3 hours from now
Price change frequency: Every 5-10 minutes (based on betting volume)
Your decision latency: Sub-second (automated bot)

Real Constraint: The Odds API updates every 30-60 seconds
→ Your bottleneck is upstream data, not Kalshi feed speed
```

**When WebSocket Matters:**
- ✅ **Live in-game betting:** Prices change every few seconds
- ✅ **High-frequency trading:** Microsecond advantages matter
- ✅ **Liquidity capture:** Racing against other bots

**When WebSocket Doesn't Matter:**
- ❌ **Pre-game betting:** Hours until game, minutes between updates
- ❌ **Statistical arbitrage:** Edge is durable for minutes/hours
- ❌ **Maker strategy:** Placing bids, not taking liquidity (no race)

**Impact:**
- 🟡 Added complexity for uncertain benefit
- 🟡 More failure modes (WS disconnect, stale detection bugs)
- 🟡 Harder to test and debug

**Recommendation:**
- **MEASURE BENEFIT:** Compare fill rates with WS vs REST-only
- **CONSIDER:** Keep WS for live games, disable for pre-game
- **SIMPLIFY:** If no measurable benefit, remove WS to reduce complexity

---

### 7. ⚠️ **SCHEDULED TRADING: STRATEGY MISMATCH**

**Location:** Schedule Modal, `config.schedule`

**The Problem:**

The system allows users to schedule bot operation:
- Specific days of week
- Specific time windows
- "Only trade between 6 PM - 11 PM on Fridays"

**Strategic Contradiction:**

**Arbitrage is opportunity-driven, not time-driven.**

- Mispricing can occur at any time
- News breaks 24/7 (injuries, weather, trades)
- Best opportunities are often off-hours (when market makers are slow to update)

**Example:**
```
Scenario: Major player injury announced at 2 AM
- Sportsbooks update quickly (automated)
- Kalshi updates slowly (manual market maker sleeping?)
- HUGE arbitrage opportunity

Your Bot: Offline (scheduled for 6 PM - 11 PM only)
Result: Missed the best trade of the week
```

**Valid Use Cases for Scheduling:**
- ✅ Avoiding specific game times (when you expect high volatility and adverse selection)
- ✅ Budget management (limiting API usage to certain hours)
- ⚠️ Personal preference (only trade when you can monitor)

**Invalid Use Cases:**
- ❌ "Thinking" certain hours are more profitable (untested hypothesis)
- ❌ Restricting bot because it "feels safer"

**Impact:**
- 🟡 Potential missed opportunities
- 🟡 Reduced sample size for strategy validation
- 🟡 Adds complexity (one more config option)

**Recommendation:**
- **KEEP:** Feature is useful for API budget management
- **WARN:** Add UI warning that scheduling may miss opportunities
- **TRACK:** Log how many opportunities were skipped due to schedule

---

### 8. ⚠️ **MISSING RISK MANAGEMENT: CORRELATION & LIQUIDITY**

**Location:** Missing from strategy documentation

**The Problem:**

The current strategy focuses on position *count* limits but ignores:

1. **Correlation Risk:**
   ```
   Current: Max 10 positions
   Reality: All 10 positions could be NFL games on the same Sunday

   If one game has a controversial referee call:
   - All NFL markets might reprice
   - Correlated losses across all positions
   - Not truly diversified
   ```

2. **Liquidity Risk:**
   ```
   Entry: Easy (Auto-Bid finds opportunities and places orders)
   Exit: Harder (Auto-Close places sell orders, but will they fill?)

   What if Kalshi market has low volume?
   - Your sell order sits unfilled
   - Fair Value moves against you
   - Can't exit at target price
   ```

3. **Settlement Risk:**
   ```
   Sportsbooks: Settled by official league stats
   Kalshi: Settled by Kalshi market maker (human judgment?)

   What if they disagree on outcome?
   - Sportsbook says Team A won
   - Kalshi settles for Team B (different interpretation)
   - Your "sure thing" becomes a loss
   ```

**Impact:**
- 🔴 **Unquantified risk:** Position limit doesn't guarantee diversification
- 🔴 **Liquidity assumptions:** Strategy assumes you can always exit at FV (untested)
- 🔴 **Settlement uncertainty:** No documentation on how Kalshi settles edge cases

**Recommendation:**

**ADD RISK MANAGEMENT FEATURES:**

1. **Sport/League Diversification:**
   - Limit positions per sport (e.g., max 5 NFL, 3 NBA, 2 MLB)
   - Reduces correlation risk

2. **Liquidity Threshold:**
   - Only bid on markets with minimum volume (e.g., >100 contracts traded)
   - Check bid-ask spread width (e.g., spread < 5¢)
   - Ensures you can exit when needed

3. **Settlement Monitoring:**
   - Track settlement disputes (manual log or API)
   - Document Kalshi settlement policies
   - Adjust strategy if settlement risk is material

---

### 9. ⚠️ **ANALYTICS VS. EXECUTION: MISPLACED EFFORT**

**Location:** Statistics Banner, Win Rate, T-Statistic

**The Problem:**

**Statistical Significance (T-Statistic):**
```javascript
// Only computed after 5+ auto-bid trades
const tStat = calculateTStatistic(autoTrades);
const isSignificant = tStat > 1.96; // α = 0.05
```

**What It Tells You:**
- Whether your observed win rate is statistically different from 50% random chance
- Useful for validating that your strategy has edge

**What It Doesn't Tell You:**
- Whether your *current* trade is +EV
- How to adjust strategy parameters
- Where the edge is coming from

**Strategic Reality:**

This is **backwards-looking validation**, not **forward-looking execution**.

- ✅ Good for: Post-mortem analysis, strategy validation
- ❌ Bad for: Real-time trading decisions
- ❌ Misleading: Can give false confidence (small sample size, luck)

**Similar Issues:**
- **Win Rate:** Useful for reporting, doesn't inform next trade
- **Realized PnL:** Same as above
- **Session Time:** Vanity metric

**Impact:**
- 🟡 **Effort mismatch:** Time spent building analytics that don't improve execution
- 🟡 **User distraction:** Traders focus on stats instead of strategy refinement
- 🟡 **False confidence:** "60% win rate after 10 trades" is statistically meaningless

**Recommendation:**
- **KEEP:** These features are useful for reporting
- **DE-EMPHASIZE:** Move to a separate "Analytics" tab, not prominent banner
- **FOCUS EFFORT:** Spend more time on execution logic (risk management, entry/exit quality) than analytics polish

---

## Recommendations Summary

### Priority 1: CRITICAL (Do First)

1. ✅ **Remove or Invert Volatility Padding**
   - Current logic is backwards
   - Highest-edge opportunities occur during volatility
   - Quick fix: Set volatility multiplier to 0 or make it negative

2. ✅ **Fix Taker Fee Buffer**
   - Set minimum buffer to 2-3¢ to avoid fee erosion
   - Calculate fee-aware edge before crossing spread
   - Document when/why taker strategy is appropriate

3. ✅ **Refactor App.jsx**
   - Extract bot logic to separate modules
   - Extract UI components
   - Make codebase maintainable
   - **This enables all other improvements**

### Priority 2: HIGH (Do Soon)

4. ✅ **Clarify Auto-Close Strategy**
   - Decide: FV or FV+margin for exits?
   - Implement or remove `autoCloseMarginPercent` config
   - Document exit logic clearly

5. ✅ **Add Risk Management**
   - Sport/league diversification limits
   - Liquidity thresholds for entry
   - Settlement risk monitoring

6. ✅ **Validate Turbo Mode**
   - A/B test 15s vs 3s polling
   - Measure fill rate improvement vs cost
   - Remove if no measurable benefit

### Priority 3: MEDIUM (Do Eventually)

7. ✅ **Evaluate WebSocket Necessity**
   - Compare performance with/without WS
   - Consider enabling only for live games
   - Simplify if no significant benefit

8. ✅ **Review Scheduled Trading**
   - Add warnings about missed opportunities
   - Track skipped trades
   - Educate users on trade-offs

9. ✅ **Restructure Analytics**
   - Move stats to separate view
   - De-emphasize backwards-looking metrics
   - Focus UI on execution quality

---

## Conclusion

The Kalshi Arbitrage Dashboard has evolved from a simple statistical arbitrage system into a feature-rich trading platform. While many features provide value (analytics, UI polish, configurability), several "improvements" actually **work against the core strategy**:

1. **Volatility padding** passes up the best opportunities
2. **Crossing the spread with 0 buffer** erodes profits through fees
3. **Turbo mode** increases costs without proven benefit
4. **Massive monolithic codebase** makes further improvements difficult

**The Path Forward:**

1. **Return to First Principles:** What is the core edge? (Kalshi mispricing vs sportsbooks)
2. **Ruthlessly Simplify:** Remove features that don't improve that edge
3. **Refactor for Clarity:** Make the codebase match the strategy docs
4. **Measure Everything:** A/B test features to validate actual performance impact

**Good News:** The foundation is solid. The strategy is sound. The issues are fixable. Focus on execution quality over feature quantity, and this can be a highly effective arbitrage system.

---

## Appendix: Quick Wins

**Can be implemented in < 1 hour each:**

1. Set `volatility * 0` in `calculateStrategy` (disable volatility padding)
2. Set `TAKER_FEE_BUFFER = 3` (minimum fee coverage)
3. Add comment in UI: "⚠️ Turbo Mode increases API costs 5x"
4. Hide T-Statistic until 30+ trades (statistical validity)
5. Log skipped opportunities due to schedule (visibility)

**These quick fixes will immediately improve profitability and reduce costs while you plan larger refactoring efforts.**

---

*End of Review*
