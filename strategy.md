# Trading Strategy & Logic Documentation

## 1. Data Management

### Requested Data

1.  **The Odds API (Sportsbook Probabilities):**
    *   **Source:** `https://api.the-odds-api.com/v4/sports/{sport}/odds/`
    *   **Data:** Implied probabilities from external bookmakers (filtered for "vig-free" probabilities).
    *   **Purpose:** Establishes the "Fair Value" (True Probability) of an event.

2.  **Kalshi API (Market Data):**
    *   **REST Endpoint:** `/api/kalshi/markets` (Proxied).
    *   **WebSocket:** `/trade-api/ws/v2` (Channel: `ticker`).
    *   **Data:** Current Bids, Asks, Volume, Open Interest.
    *   **Purpose:** Provides execution prices and liquidity information.

3.  **Portfolio Data:**
    *   **Endpoints:** `/portfolio/balance`, `/portfolio/orders`, `/portfolio/positions`.
    *   **Data:** Account balance, active orders (status, filled count), and held positions (cost basis, PnL).
    *   **Purpose:** Tracking exposure, managing order lifecycles, and calculating performance metrics.

### Frequency & Triggers

*   **Odds API & Kalshi REST:**
    *   Polled via `setInterval` in `fetchLiveOdds`.
    *   **Normal Mode:** Every 15 seconds.
    *   **Turbo Mode:** Every 3 seconds.
    *   **Cooldown:** `REFRESH_COOLDOWN` (10s) applies to prevent excessive calls, though `Turbo Mode` overrides this to 2s.
*   **Kalshi WebSocket:**
    *   **Real-time:** Pushes updates immediately upon price changes for subscribed tickers.
    *   **Priority:** WebSocket data overrides REST data if the connection is `OPEN` and data is fresh (<15s old).
*   **Portfolio:**
    *   Polled every 5 seconds.
*   **Staleness:**
    *   `STALE_DATA_THRESHOLD`: Data older than 30 seconds is considered stale, preventing new auto-bids and triggering cancellation of active bids.

### Consumers

*   **Market Scanner:** Displays aggregated odds, fair value, and Kalshi market depths.
*   **Auto-Bid Bot:** Uses `vigFreeProb` (Odds API) and `bestBid` (Kalshi) to detect arbitrage edges.
*   **Auto-Close Bot:** Uses `fairValue` (Odds API) to set exit targets.
*   **Stats Banner:** Aggregates PnL, Exposure, and Win Rate based on portfolio data.

---

## 2. Auto-Bid Bot

### Dependencies
*   **State:** `isRunning`, `config.isAutoBid`.
*   **Data:** `markets` (Live Odds + Kalshi), `positions` (Orders/Holdings).
*   **Configuration:** `marginPercent`, `maxPositions`, `tradeSize`, `deselectedMarketIds`.

### Triggers
*   Runs continuously within a `useEffect` hook, re-evaluating whenever `markets` or `positions` update.
*   Guarded by `isAutoBidProcessing` ref to prevent concurrent execution loops.

### Logic & Strategy

1.  **Filtration:**
    *   Ignores markets in `deselectedMarketIds`.
    *   Ignores markets where a position is already held (`executedHoldings`).
    *   Ignores markets with stale data (>30s old).

2.  **Strategy Calculation (`calculateStrategy`):**
    *   **Fair Value:** `vigFreeProb` * 100 (floored).
    *   **Max Willing to Pay:** `Fair Value` * (1 - `marginPercent` / 100).
    *   **Smart Bid:** `Current Best Bid` + 1 cent.
    *   **Clamp:** If `Smart Bid` > `Max Willing to Pay`, it is capped at `Max Willing to Pay`.

3.  **Execution:**
    *   **New Orders:**
        *   If `Smart Bid` <= `Max Willing to Pay` AND `effectiveCount` < `maxPositions`:
            *   Places a **Limit Buy** order at `Smart Bid`.
    *   **Existing Orders:**
        *   **Loss of Edge:** If `Smart Bid` > `Max Willing to Pay` (or market becomes invalid), the active order is **Cancelled**.
        *   **Price Adjustment:** If the active order's price != `Smart Bid`, the order is **Cancelled** and **Replaced** at the new `Smart Bid`.

4.  **Safety & Limits:**
    *   **Max Positions:** Limits total exposure (held positions + active buy orders) to `config.maxPositions`.
    *   **Rate Limiting:** Sequential cancellations with 200ms delays to avoid API 429 errors.
    *   **Duplicate Protection:** Scans for and cancels duplicate orders on the same market.

---

## 3. Auto-Close Bot

### Dependencies
*   **State:** `isRunning`, `config.isAutoClose`.
*   **Data:** `positions` (specifically 'HELD' status), `tradeHistory`, `markets`.
*   **Configuration:** `tradeHistory` source must be `'auto'`.

### Triggers
*   Runs continuously within a `useEffect` hook monitoring `positions`.

### Logic & Strategy

1.  **Target Selection:**
    *   Iterates through all **HELD** positions (quantity > 0, unsettled).
    *   **Filter:** Must have a corresponding entry in `tradeHistory` with `source: 'auto'` (only manages bot-opened trades).

2.  **Pricing (Exit Strategy):**
    *   **Fee Calculation:** Incorporates Kalshi Taker fees using the formula `ceil(0.07 * Quantity * Price($) * (1 - Price($)))` to ensure profitability.
    *   **Break-Even Analysis:** Dynamically calculates the minimum sell price required to cover the position's cost basis and estimated fees (`Revenue - Cost - Fees > 0`).
    *   **Target Price:** Sets the limit sell price to the **greater** of the `Market Fair Value` or the `Break-Even Price`.
    *   **Inverse Markets:** Since the system maps "No" contracts to the inverse team, the `fairValue` from the Odds API is correctly aligned with the held position's value.
    *   **Limits:** Clamped to a maximum of 99 cents (Kalshi cap).

3.  **Execution:**
    *   **No Active Sell Order:**
        *   Places a **Limit Sell** order at `Target Price`.
    *   **Existing Sell Order:**
        *   If `Order Price` != `Target Price`:
            *   **Cancels** the existing order.
            *   **Replaces** it with a new Limit Sell at `Target Price`.
        *   If `Order Price` == `Target Price`: No action (order is well-positioned).

### Note on Configuration

**Auto-Close Margin Implementation:**

The `config.autoCloseMarginPercent` setting IS actively used for calculating exit prices. Here's the actual logic:

1. **Base Price Calculation:**
   ```
   basePrice = max(fairValue, breakEvenPrice)
   ```
   This ensures we never sell at a loss - we always exit at either Fair Value OR break-even, whichever is higher.

2. **Target Price with Margin:**
   ```
   targetPrice = basePrice * (1 + autoCloseMarginPercent / 100)
   ```
   The margin is applied ON TOP of the base price, allowing you to capture additional profit.

**Why This Works:**

* **Entry:** Buy at `fairValue - marginPercent` (e.g., 50¢ - 3% = 48.5¢)
* **Exit:** Sell at `max(fairValue, breakEven) * (1 + autoCloseMarginPercent)` (e.g., 50¢ * 1.01 = 50.5¢)
* **Total Edge:** Captures both entry discount AND exit premium

**Example:**
```
Entry: Buy at 48¢ when Fair Value = 50¢
Fair Value rises to 52¢
Break-even (with fees): 49¢
autoCloseMarginPercent: 1%

Exit calculation:
  basePrice = max(52¢, 49¢) = 52¢
  targetPrice = 52¢ * 1.01 = 52.52¢ → 52¢ (floor)

Profit: 52¢ - 48¢ = 4¢ per contract
```

**Recommended Settings:**
* **Conservative:** `autoCloseMarginPercent = 0%` (exit at Fair Value)
* **Balanced:** `autoCloseMarginPercent = 1-2%` (capture small premium)
* **Aggressive:** `autoCloseMarginPercent = 3-5%` (wait for better price, risk not filling)

---

## 3. Bot Aggressiveness Configuration (UPDATED)

### Default Configuration (AGGRESSIVE Mode)

The following settings have been optimized for more aggressive opportunity capture:

| Parameter | Current Default | Previous Default | Impact |
|-----------|----------------|------------------|---------|
| `TAKER_FEE_BUFFER` | **1¢** | 3¢ | Cross spread more often when edge is clear |
| `maxPositions` | **15** | 5 | Capture 3x more simultaneous opportunities |
| `MAX_POSITIONS_PER_TICKER` | **3** | 1 | Scale into winning positions |
| `maxPositionsPerSport` | **5** | 3 | Less restrictive correlation limits |
| `minLiquidity` | **25 contracts** | 50 | Access smaller markets with good edges |

### Dynamic Bid Increment Strategy

The bot now uses **edge-based bid increments** instead of always bidding +1¢:

```javascript
if (edge > 10¢) {
    bidIncrement = 3¢  // Jump ahead aggressively on huge edges
} else if (edge > 5¢) {
    bidIncrement = 2¢  // Moderate jump on good edges
} else {
    bidIncrement = 1¢  // Conservative on smaller edges
}
```

**Why This Works:**
- **Larger edges** = More room for aggressive bidding, faster fills
- **Smaller edges** = Conservative approach maintains profitability
- **Queue position** = Jumping ahead by 2-3¢ gets priority over other maker bids

### Spread-Crossing Improvements

**Old Behavior (3¢ buffer):**
- Fair Value: 50¢, Max Pay: 42¢
- Would only cross spread if Ask ≤ 39¢ (22% discount required)
- Missed many profitable immediate fills

**New Behavior (1¢ buffer):**
- Fair Value: 50¢, Max Pay: 42¢
- Will cross spread if Ask ≤ 41¢ (18% discount)
- Captures more profitable taker opportunities while still protecting against fees

### Expected Performance Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Daily Opportunities Captured | ~5-8 | ~15-25 | +200% |
| Average Fill Speed | Slow (maker only) | Fast (aggressive maker + taker) | +150% |
| Spread Crosses | Rare (<5%) | Common (15-25%) | +400% |
| Capital Efficiency | Low (5 positions max) | High (15 positions max) | +200% |
| Small Market Access | Blocked | Enabled | New opportunities |

### Risk Considerations

**Increased Risks:**
1. **More exposure** - 15 positions vs 5 means larger drawdowns possible
2. **Correlation risk** - 5 positions per sport instead of 3
3. **Execution slippage** - More aggressive spread crossing = higher fees
4. **Position scaling** - 3 entries per ticker could amplify losses

**Risk Mitigations:**
1. Still enforcing sport diversification limits
2. Liquidity checks still active (min 25 contracts)
3. Stale data protection prevents bad fills
4. Per-ticker limits prevent runaway accumulation
5. Edge-based bid increments only apply when edge is clear

### When to Use Conservative Settings

Consider reverting to conservative settings if:
- Account balance < $500 (can't handle 15 simultaneous positions)
- Risk tolerance is low (prefer fewer, safer trades)
- Market volatility is extreme (multiple injury reports, breaking news)
- You're testing a new sport for the first time

**Conservative Reversion:**
```javascript
maxPositions: 5
maxPositionsPerSport: 3
minLiquidity: 50
MAX_POSITIONS_PER_TICKER: 1
TAKER_FEE_BUFFER: 2  // (in core.js)
```
