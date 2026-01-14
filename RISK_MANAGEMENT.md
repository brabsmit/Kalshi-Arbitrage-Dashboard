# Risk Management Guide

**Last Updated:** 2026-01-14
**Purpose:** Document risk management features and monitoring practices

---

## Overview

The Kalshi Arbitrage Dashboard includes several risk management features to protect against common pitfalls in sports betting arbitrage:

1. **Correlation Risk** - Sport diversification limits
2. **Liquidity Risk** - Volume and spread filtering
3. **Settlement Risk** - Market resolution monitoring
4. **Operational Risk** - Turbo mode cost tracking

---

## 1. Correlation Risk Management

### Problem

When all positions are concentrated in a single sport or league, systematic events can cause correlated losses:

- Controversial referee calls affecting multiple games
- League-wide news (strike, scandal, rule changes)
- Weather events (e.g., all outdoor games on same day)
- Coordinated market maker adjustments

**Example:**
```
Portfolio: 5 positions, all NFL games on Sunday
Event: Referee makes controversial call in one game
Impact: Kalshi reprices ALL NFL markets based on perceived referee bias
Result: All 5 positions move against you simultaneously
```

### Solution: Sport Diversification Limits

**Configuration:**
- `enableSportDiversification` - Toggle feature on/off
- `maxPositionsPerSport` - Maximum positions in any single sport (default: 3)

**How It Works:**
```javascript
// Bot tracks positions per sport
positionsPerSport = {
  'NFL': 3,    // At limit
  'NBA': 2,    // Below limit
  'MLB': 1     // Below limit
}

// New NFL opportunity appears
if (positionsPerSport['NFL'] >= maxPositionsPerSport) {
  skip(); // Don't take position, already at limit
}
```

**Recommended Settings:**
- **Conservative:** `maxPositionsPerSport = 2` (max 40% in any sport with 5 total positions)
- **Balanced:** `maxPositionsPerSport = 3` (max 60% in any sport)
- **Aggressive:** `maxPositionsPerSport = maxPositions` (no sport limits)

**Monitoring:**
Check position distribution regularly in the Portfolio tab. Ideally, positions are spread across 2-3 different sports.

---

## 2. Liquidity Risk Management

### Problem

Entering a position is easy, but exiting requires a counterparty. Low-liquidity markets pose risks:

1. **Can't Exit at Fair Value:**
   - Your sell order sits unfilled
   - Fair value moves against you while waiting
   - Forced to accept worse price to exit

2. **Wide Bid-Ask Spreads:**
   - Fair Value = 50¢, but market shows 45¢ bid / 55¢ ask
   - To exit immediately, must cross 5¢ spread (10% loss)
   - Negates arbitrage edge

3. **Stale Pricing:**
   - Low volume = infrequent updates
   - Market may not reflect current true probability
   - Risk of adverse selection

**Example:**
```
Entry:
- Fair Value: 52¢
- Kalshi Best Bid: 48¢, Best Ask: 50¢
- You buy at 50¢ (2¢ edge)

Exit Attempt:
- Fair Value rises to 54¢
- But market shows: 48¢ bid / 56¢ ask (8¢ spread!)
- Total volume: 20 contracts (very low)
- Your sell order at 54¢ sits unfilled for hours

Outcome:
- Fair Value drops back to 50¢ before you can exit
- 2¢ edge evaporates, stuck at break-even
```

### Solution: Liquidity Filtering

**Configuration:**
- `enableLiquidityChecks` - Toggle feature on/off
- `minLiquidity` - Minimum total volume in contracts (default: 50)
- `maxBidAskSpread` - Maximum spread in cents (default: 5¢)

**How It Works:**

#### Volume Check
```javascript
if (market.volume < config.minLiquidity) {
  skip(); // Too illiquid, can't exit reliably
}
```

Markets with higher volume = more active trading = easier to exit

#### Spread Check
```javascript
spread = bestAsk - bestBid;
if (spread > config.maxBidAskSpread) {
  skip(); // Spread too wide, exit costs too high
}
```

Tight spreads indicate liquid markets where you can exit near fair value.

**Recommended Settings:**

**Conservative (Prioritize Liquidity):**
- `minLiquidity = 100` contracts
- `maxBidAskSpread = 3¢`
- **Trade-off:** Fewer opportunities, but easy exits

**Balanced (Default):**
- `minLiquidity = 50` contracts
- `maxBidAskSpread = 5¢`
- **Trade-off:** Moderate opportunity set with acceptable exit friction

**Aggressive (Maximize Opportunities):**
- `minLiquidity = 20` contracts
- `maxBidAskSpread = 10¢`
- **Trade-off:** More opportunities, but harder to exit at target price

### Monitoring Liquidity

**Before Entering:**
- Check market volume (logged in console)
- Check current bid-ask spread
- Compare to your thresholds

**While Holding:**
- Monitor if volume is increasing or decreasing
- Watch spread width - widening spread = worsening liquidity
- Consider early exit if liquidity deteriorates

**Red Flags:**
- Volume drops below 20 contracts
- Spread widens beyond 10¢
- No trades for >1 hour (check recent fills)

---

## 3. Settlement Risk Management

### Problem

Sports betting arbitrage assumes that Kalshi and sportsbooks will settle markets identically. But settlement discrepancies can occur:

**Potential Mismatches:**

1. **Stat Provider Differences:**
   - Sportsbooks use ESPN stats
   - Kalshi uses official league stats
   - Discrepancies: overtime stats, stat corrections

2. **Market Interpretation:**
   - "Team X to win" - does overtime count?
   - "Over 45.5 points" - does a forfeit count as 0?
   - Edge cases not clearly defined

3. **Timing Delays:**
   - Sportsbook settles immediately after game
   - Kalshi waits for "official" result (next day)
   - Risk: market reprices before settlement

4. **Human Error:**
   - Manual market resolution by Kalshi market makers
   - Possible mistakes (rare but documented)

**Real Example:**
```
NFL Game: Team A vs Team B
Your Position: Bought "Team A Wins" at 48¢ (Fair Value 52¢)

Outcome:
- Final score: Team A wins 24-21
- DraftKings settles as "Team A Win" ✓
- Kalshi initially settles as "Team B Win" ✗ (error!)

Resolution:
- You contest settlement with Kalshi support
- After review, they correct to "Team A Win"
- Settlement delayed by 3 days, capital locked

Risk Realized:
- Capital locked during dispute
- Emotional stress / time spent on support
- If Kalshi hadn't corrected: 100% loss on position
```

### Monitoring Settlement Risk

**Pre-Trade Due Diligence:**

1. **Read Market Rules:**
   - Click through to Kalshi market page
   - Read "Settlement Criteria" section
   - Verify it matches your understanding

2. **Check Stat Source:**
   - What's the "official" source for settlement?
   - Does it match the sportsbook's source?
   - Are there known discrepancies for this stat?

3. **Historical Disputes:**
   - Check Kalshi Discord / Reddit for past disputes
   - Has this market type had settlement issues?
   - Are rules clear and unambiguous?

**Post-Trade Monitoring:**

1. **Track Game Results:**
   - After game ends, verify outcome yourself
   - Cross-reference multiple sources (ESPN, official league, etc.)
   - Don't rely solely on Kalshi settlement

2. **Immediate Settlement Check:**
   - When Kalshi settles, verify correctness
   - If incorrect, file dispute IMMEDIATELY
   - Screenshot evidence (box scores, official stats)

3. **Document Everything:**
   - Keep trade history (already tracked in dashboard)
   - Note Fair Value at entry vs settlement price
   - Track settlement disputes and resolutions

**Settlement Dispute Process:**

If you believe a market was settled incorrectly:

1. **Gather Evidence:**
   - Official box score / game stats
   - Screenshots of game result
   - Kalshi market rules screenshot

2. **Contact Support:**
   - Email: support@kalshi.com
   - Kalshi Discord: #support channel
   - Include market ticker, your position, evidence

3. **Escalate if Needed:**
   - If initial response unsatisfactory, escalate
   - Request review by senior market operations
   - Cite specific rule violation

4. **Community Support:**
   - Post in Kalshi Discord (others may have same issue)
   - Collective pressure can expedite resolution

**Risk Mitigation:**

- ✅ **Stick to Clear Markets:** "Team X to Win" is unambiguous
- ⚠️ **Avoid Complex Props:** "Player X over 2.5 assists" has more edge cases
- ✅ **Major Leagues Only:** NFL, NBA have clear stat providers
- ⚠️ **Avoid Niche Sports:** Less oversight, higher dispute risk

**Expected Settlement Risk:**
- **Good Markets:** <1% dispute rate (clear rules, major sports)
- **Risky Markets:** 5-10% dispute rate (complex props, niche sports)

---

## 4. Operational Risk: Turbo Mode Cost Tracking

### Problem

Turbo Mode increases polling frequency from 15 seconds to 3 seconds (5x increase). This has operational costs and benefits that should be measured.

**Costs:**
1. **API Quota Burn:** 5x more requests to The-Odds-API
2. **Rate Limiting Risk:** Hitting API rate limits
3. **Server Load:** More requests to Kalshi API
4. **Attention Required:** More frequent order updates = more noise

**Potential Benefits:**
1. **Faster Edge Capture:** See opportunities 12 seconds sooner
2. **Better Fill Rates:** Update orders more frequently
3. **Reduce Adverse Selection:** Cancel stale orders faster

**Question:** Do the benefits outweigh the costs?

### Tracking Turbo Mode Performance

**Metrics to Track:**

#### 1. API Usage Efficiency
```
Metric: Requests per Opportunity Found
Formula: Total API Requests / Opportunities Found

Normal Mode: 100 requests / 5 opportunities = 20 req/opp
Turbo Mode: 500 requests / 7 opportunities = 71 req/opp

Analysis: Turbo found 40% more opportunities but used 5x requests
Cost per opportunity: 3.5x higher in Turbo
```

#### 2. Fill Rate Comparison
```
Metric: Orders Filled / Orders Placed
Formula: (Filled Orders) / (Total Orders Placed)

Normal Mode: 15 fills / 20 orders = 75% fill rate
Turbo Mode: 18 fills / 22 orders = 82% fill rate

Analysis: 7% improvement in fill rate
Is 7% worth 5x API cost?
```

#### 3. Edge Capture Rate
```
Metric: Average Edge at Entry
Formula: (Fair Value - Fill Price) average across all fills

Normal Mode: Average 2.5¢ edge at entry
Turbo Mode: Average 2.8¢ edge at entry

Analysis: 0.3¢ improvement (12% better edge)
```

#### 4. Adverse Selection Reduction
```
Metric: % of Orders Filled Then Immediately Repriced Against
Formula: (Orders where FV dropped <5min after fill) / Total Fills

Normal Mode: 6 adverse selections / 15 fills = 40%
Turbo Mode: 5 adverse selections / 18 fills = 28%

Analysis: 12% reduction in adverse selection
Faster cancellation prevents bad fills
```

### How to Track (Implementation)

Currently, the dashboard logs:
- API requests in header (x-requests-used / x-requests-remaining)
- Trade history with timestamps and fair values

**Add to Trade History:**
```javascript
{
  ticker: "KXNFLGAME-123",
  entryPrice: 48,
  fairValueAtEntry: 52,
  fillTimestamp: Date.now(),
  mode: config.isTurboMode ? 'turbo' : 'normal',
  apiRequestsConsumed: /* track this */
}
```

**Weekly Analysis:**
```javascript
// Filter trades by mode
const turboTrades = trades.filter(t => t.mode === 'turbo');
const normalTrades = trades.filter(t => t.mode === 'normal');

// Compare metrics
const turboFillRate = turboTrades.filter(t => t.filled).length / turboTrades.length;
const normalFillRate = normalTrades.filter(t => t.filled).length / normalTrades.length;

console.log(`Turbo: ${turboFillRate} vs Normal: ${normalFillRate}`);
```

### Recommended Approach

**Week 1: Baseline (Normal Mode)**
- Track all metrics in normal 15s mode
- Establish baseline performance

**Week 2: Turbo Test**
- Enable Turbo Mode
- Track same metrics
- Monitor API quota burn rate

**Week 3: Analysis**
- Compare metrics side-by-side
- Calculate ROI: (Extra Profit from Turbo) / (Extra API Cost)
- Decision: Keep Turbo if ROI > 2x

**Expected Outcome:**
Based on arbitrage theory, Turbo Mode is likely NOT worth it for pre-game betting:
- Odds don't change second-to-second
- Edge is durable for minutes/hours
- Bottleneck is The-Odds-API update frequency (30-60s)

**When Turbo MIGHT Help:**
- ✅ Live in-game betting (fast odds movement)
- ✅ Breaking news scenarios (injury reports)
- ⚠️ Pre-game betting (probably not worth it)

---

## 5. Position Sizing & Bankroll Management

While not automated, recommended practices:

**Kelly Criterion:**
```
Optimal Bet Size = (Edge × Probability) / Edge
Example: 4¢ edge on 52% probability = ~8% of bankroll per bet
```

**Conservative Approach:**
- Never bet more than 5% of bankroll on single position
- Limit total exposure to 50% of bankroll
- Keep 50% in cash for opportunities

**Monitoring Bankroll:**
```
Current Exposure: $500 (locked in positions + pending orders)
Current Balance: $800
Total Bankroll: $1,300

Exposure Ratio: $500 / $1,300 = 38% (healthy)
Cash Ratio: $800 / $1,300 = 62% (good reserves)
```

If Exposure > 70%, consider:
- Reducing `maxPositions`
- Reducing `tradeSize`
- Closing marginal positions early

---

## Risk Monitoring Checklist

**Daily:**
- [ ] Check position distribution across sports
- [ ] Monitor bid-ask spreads on held positions
- [ ] Review any settlement-pending markets

**Weekly:**
- [ ] Analyze win rate and profitability by sport
- [ ] Check API quota usage (normal vs turbo)
- [ ] Review any disputed settlements

**Monthly:**
- [ ] Analyze correlation of losses (same-day? same-sport?)
- [ ] Evaluate liquidity thresholds (too tight? too loose?)
- [ ] Review and update risk limits based on bankroll changes

---

## Emergency Procedures

**If API Quota Exhausted:**
1. Stop bot immediately
2. Wait for quota reset (usually daily)
3. Consider upgrading API plan OR disabling Turbo Mode

**If Settlement Dispute:**
1. Document everything (screenshots, stats)
2. File support ticket immediately
3. Don't close position until resolved

**If Multiple Correlated Losses:**
1. Stop bot and review positions
2. Identify common factor (same sport? same day? same book?)
3. Adjust diversification settings to prevent recurrence

**If Liquidity Dries Up:**
1. Don't panic sell (accept unfavorable price)
2. Wait for market to develop liquidity
3. Consider partial exit (sell half at fair value)
4. Adjust future `minLiquidity` threshold higher

---

## Summary

Risk management is about **controlling what you can control**:

✅ **Can Control:**
- Position diversification (sport limits)
- Liquidity filtering (volume/spread)
- Operational costs (Turbo mode)
- Settlement verification (check results)

❌ **Cannot Control:**
- Whether sportsbooks update at same time
- Whether Kalshi markets have liquidity
- Whether settlements are correct (but can dispute)
- Whether news breaks mid-position

**Best Practice:** Focus on risk mitigation through diversification and filtering, not on predicting uncontrollable events.

---

*Last Updated: 2026-01-14*
