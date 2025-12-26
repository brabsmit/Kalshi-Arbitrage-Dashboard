## 2024-05-23 - Volatility Adjusted Margin

**Hypothesis:**
High volatility in the underlying Odds API probability implies that the calculated "Fair Value" is unstable. Entering a trade at a specific snapshot of a volatile Fair Value increases the risk of immediate mean reversion (paying too much). By increasing the required margin of safety when volatility is high, we avoid buying "peaks" and only enter if the discount is deep enough to compensate for the instability.

**Change:**
Adjust the `marginPercent` used in `calculateStrategy` by adding the market's historical volatility (Standard Deviation of vig-free probability).

**Math:**
```javascript
const effectiveMargin = marginPercent + market.volatility;
const maxWillingToPay = Math.floor(fairValue * (1 - effectiveMargin / 100));
```

**Expected Result:**
- **Lower Risk:** The bot will bid significantly lower (or not at all) on markets where the odds are thrashing.
- **Improved Entry:** We capture better prices on volatile events.
- **Lower Fill Rate:** We might miss some trades in fast-moving markets, but "Cash is a position."
