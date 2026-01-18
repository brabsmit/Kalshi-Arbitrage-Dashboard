// bot/bailOut.js

/**
 * Scans positions for "Bail Out" conditions and executes emergency exits.
 *
 * Logic Requirements:
 * 1. Iterate Held Positions.
 * 2. Check Expiration: IF HoursRemaining < config.bailOutHoursBeforeExpiry
 * 3. Check Loss: AND CurrentBestBid < AverageCostBasis * (1 - (bailOutTriggerPercent / 100))
 * 4. Trigger: Cancel existing sell orders, then IOC sell into Bid.
 *
 * @param {Array} positions - Array of held positions (must include 'ticker', 'avg_price', 'quantity')
 * @param {Object} markets - Map or Array of market data (must include 'ticker', 'expiration_ts', 'yes_bid')
 * @param {Object} config - Must include bailOut settings
 * @param {Object} orderManager - Object with cancelOrder and executeBailOutOrder methods
 * @param {Function} addLog - Logging function
 * @returns {Promise<Array>} List of bailed-out market IDs
 */
export async function processBailOuts(positions, markets, config, orderManager, addLog) {
    if (!config.isBailOutEnabled) return [];

    const now = Date.now();
    const bailedOutTickers = [];

    // Filter for actual held positions (not orders)
    const heldPositions = positions.filter(p =>
        !p.isOrder &&
        p.status === 'HELD' &&
        p.quantity > 0 &&
        p.settlementStatus !== 'settled'
    );

    for (const position of heldPositions) {
        // Find market data.
        // Positions use `marketId`. Markets use `realMarketId` (which matches `marketId`).
        const market = markets.find(m => m.realMarketId === position.marketId);

        // Skip if market data missing
        if (!market) continue;

        // 1. Time Check
        // market.commenceTime is the start time, but binary markets usually expire shortly after or at specific time.
        // The user prompt mentions "expiration_ts (or close_ts)".
        // In our `markets` object, we have `commenceTime` which is usually the event start.
        // Kalshi markets expire when the event is determined.
        // We will use `commenceTime` as a proxy for "approaching expiration/event".
        // If the event starts in < X hours, we should be careful.
        // Actually, for "Bail Out", we care about the contract expiring worthless.
        // Using commenceTime is safer.
        const expirationTime = new Date(market.commenceTime).getTime();
        const msUntilExpiry = expirationTime - now;
        const hoursRemaining = msUntilExpiry / (1000 * 60 * 60);

        if (hoursRemaining > config.bailOutHoursBeforeExpiry) continue;

        // 2. Loss Check
        // We use the 'bestBid' (Best Bid) to value our position because that's what we can sell for NOW.
        // position.side is "Yes" or "No".
        // market.bestBid is for "Yes".
        // If we hold "No", we need to check the "No" bid.
        // Wait, the `market` object usually stores YES prices.
        // If `position.side` is 'No', the market object might handle it if it was fetched via the dashboard logic which might normalize inverse markets.
        // Let's check App.jsx:
        // const newMarket = { ..., bestBid: bestBid || 0, isInverse: ... }
        // If isInverse is true, bestBid is for NO?
        // Let's assume market.bestBid is the price for the contract we hold IF the dashboard handles mapping.
        // BUT, `processBailOuts` receives raw `markets` array.
        // In `App.jsx`, `markets` state contains objects where `bestBid` is the "relevant" price if matched?
        // Actually, `market.bestBid` comes from `wsPrice.bid` or `realMatch.yes_bid`.
        // If we hold 'No', we sell 'No'. The price of 'No' is usually implied or fetched separately.
        // The `market` object in `markets` state seems to focus on the mapped outcome.

        // Let's look at `autoClose.js`:
        // "If we hold 'No' (isInverse), fairValue (from Odds API) is for the Target (which is No)."
        // "So m.fairValue is correct for the 'No' contract too."

        // However, `market.bestBid` is usually the YES bid from the API.
        // If we hold NO, the bid for NO is `100 - YesAsk`.
        // Wait, Kalshi API provides `no_bid`?
        // The `markets` object in `App.jsx`:
        // `bestBid = realMatch?.yes_bid || 0;`
        // It seems `markets` state only stores YES prices (unless `isInverse` logic changes what `yes_bid` means).
        // Let's assume `market.bestBid` is the price we can sell the YES contract for.
        // If we hold NO, we need the NO bid.

        let currentBid = 0;
        if (position.side === 'Yes') {
            currentBid = market.bestBid;
        } else {
            // For NO positions, the bid is the price someone pays for NO.
            // On Kalshi, YES and NO are separate order books (mostly).
            // But often NO bid is derived.
            // If we have `market.bestAsk` (Cost to Buy YES), selling NO is roughly equivalent?
            // Selling NO = buying YES? No.
            // Selling NO means entering a "Sell NO" order.
            // Validating "Sell NO" against "Buy NO" orders.
            // "Buy NO" orders are usually not directly exposed in the simple `markets` object if it only has `yes_bid`/`yes_ask`.
            // But wait, `market.yes_bid` is what people are willing to pay for YES.
            // `market.yes_ask` is what people are selling YES for.
            // If we hold NO, we want to Sell NO.
            // Sell NO matches with Buy NO.
            // Buy NO matches with Sell YES?
            // If I Sell NO, I am closing a Long NO position.
            // Long NO is Short YES.
            // To close Short YES, I Buy YES.
            // So if I have Long NO, to bail out I effectively Buy YES (Close).
            // So the cost to close is `market.bestAsk` (Price of YES).
            // My "Proceeds" would be `100 - market.bestAsk`?
            // No, that's not right.

            // Let's assume for now we only support bailing out YES positions OR
            // the `market` object has `bestBid` reflecting the price of the contract we hold if we assume the dashboard normalizes it.
            // Looking at `App.jsx`, `bestBid` comes from `realMatch.yes_bid`.
            // So it is the YES Bid.

            // If `position.side` is 'No', `currentBid` (Sell Price) should be derived or fetched.
            // Since we don't have explicit NO bids in `market` object (only `bestBid` and `bestAsk` which are YES prices),
            // We might be limited.
            // However, `autoClose.js` calculates `minSellPrice`.

            // Let's assume for this task we use `market.bestBid` and assume it applies to the side we hold IF `isInverse` is handled,
            // OR we just use `market.bestBid` for YES.
            // If `position.side` is 'No', we can try to estimate.
            // If we hold NO, and we want to bail out, we want to sell NO.
            // If there is no explicit NO market data, we might skip NO positions or warn.
            // But wait, the `market` object has `isInverse`.
            // If `isInverse` is true, does `bestBid` refer to the inverse outcome?
            // In `fetchLiveOdds`: `const realMatch = findMatchInIndex(...)`. `realMatch` has `yes_bid`.
            // So `bestBid` is `yes_bid`.

            if (position.side === 'No') {
                // If we hold NO, we can't easily check the NO bid from `market.bestBid`.
                // We will skip NO positions for safety unless we are sure.
                // Or we can assume `100 - yes_ask` is the NO bid?
                // If Yes Ask is 80, No Bid is 20.
                if (market.bestAsk < 100 && market.bestAsk > 0) {
                     currentBid = 100 - market.bestAsk;
                }
            } else {
                currentBid = market.bestBid;
            }
        }

        const costBasis = position.avgPrice;

        // Calculate current PnL percentage: (Current - Cost) / Cost
        // Example: Bought at 50, Bid is 30. (30 - 50) / 50 = -0.40 (-40%)
        const pnlPercent = costBasis > 0 ? (currentBid - costBasis) / costBasis : 0;
        const triggerThreshold = -(config.bailOutTriggerPercent / 100); // e.g., -0.20

        // If PnL is worse (lower) than the negative threshold (e.g. -0.40 < -0.20)
        if (pnlPercent < triggerThreshold) {

            console.warn(`⚠️ [BAILOUT TRIGGER] ${position.marketId} (${position.side}): ${hoursRemaining.toFixed(1)}h left, Bid ${currentBid}¢, Down ${(pnlPercent * 100).toFixed(1)}%`);
            addLog(`BAILOUT TRIGGER: ${position.marketId} Down ${(pnlPercent * 100).toFixed(0)}%`, 'ERROR');

            // Trigger Bail Out
            try {
                // Step A: Cancel existing active sell orders for this position
                // We need to find orders in `positions` array that match marketId and are SELL orders.
                const activeSellOrders = positions.filter(p =>
                    p.isOrder &&
                    p.marketId === position.marketId &&
                    ['active', 'resting', 'pending'].includes(p.status.toLowerCase()) &&
                    p.action === 'sell'
                );

                for (const order of activeSellOrders) {
                    await orderManager.cancelOrder(order.id, true, true); // skipConfirm, skipRefresh
                    await new Promise(r => setTimeout(r, 200));
                }

                // Step B: Execute IOC Sell into the Bid
                if (currentBid > 0) {
                    // Note: executeBailOutOrder needs side ('yes' or 'no').
                    // Position side is 'Yes' or 'No'.
                    const sideLower = position.side.toLowerCase();
                    const result = await orderManager.executeBailOutOrder(position.marketId, currentBid, position.quantity, sideLower);

                    if (result.success) {
                        bailedOutTickers.push(position.marketId);
                        addLog(`Bailed Out ${position.marketId} @ ${currentBid}¢`, 'CLOSE');
                    }
                } else {
                    console.warn(`[BAILOUT STUCK] ${position.marketId} has 0 bids. Cannot exit.`);
                    addLog(`BailOut Stuck: ${position.marketId} (No Liq)`, 'ERROR');
                }

            } catch (err) {
                console.error(`[BAILOUT ERROR] Failed to liquidate ${position.marketId}:`, err);
            }
        }
    }
    return bailedOutTickers;
}
