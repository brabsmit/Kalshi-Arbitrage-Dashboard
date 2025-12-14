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
*   While a `config.autoCloseMarginPercent` exists in the Settings UI, the current implementation strictly follows the **Fair Value** (plus/minus 0 margin) for exits to maximize liquidity provision at the true probability.
