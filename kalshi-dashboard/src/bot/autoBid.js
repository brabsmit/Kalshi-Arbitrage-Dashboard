// bot/autoBid.js
// Auto-bid bot logic extracted from App.jsx

import { calculateStrategy, formatDuration } from '../utils/core.js';

// Constants
const STALE_DATA_THRESHOLD = 30000; // 30 seconds

/**
 * Runs the auto-bid bot logic
 * @param {Object} params - Parameters for auto-bid
 * @param {Array} params.markets - Current market data
 * @param {Array} params.positions - Current positions and orders
 * @param {Object} params.config - Bot configuration
 * @param {Set} params.deselectedMarketIds - Markets excluded by user
 * @param {Object} params.refs - React refs for tracking state
 * @param {Object} params.orderManager - Order management functions
 * @param {Function} params.addLog - Logging function
 * @returns {Promise<void>}
 */
export async function runAutoBid(params) {
    const {
        markets,
        positions,
        config,
        deselectedMarketIds,
        refs,
        orderManager,
        addLog
    } = params;

    const {
        isAutoBidProcessing,
        autoBidTracker,
        lastFetchTimeRef,
        latestMarketsRef,
        latestDeselectedRef
    } = refs;

    // Prevent concurrent execution
    if (isAutoBidProcessing.current) return;
    isAutoBidProcessing.current = true;

    try {
        // Fix: Only count currently open/held positions towards the limit, ignoring settled history.
        // SCOPE: Only consider markets currently displayed in the scanner to support sport switching without interference.
        const currentMarketIds = new Set(markets.map(m => m.realMarketId));

        const executedHoldings = new Set(positions.filter(p =>
            !p.isOrder &&
            p.quantity > 0 &&
            p.settlementStatus !== 'settled' &&
            currentMarketIds.has(p.marketId)
        ).map(p => p.marketId));

        // Filter activeOrders to only those in the current market list
        const activeOrders = positions.filter(p =>
            p.isOrder &&
            ['active', 'resting', 'bidding', 'pending'].includes(p.status.toLowerCase()) &&
            currentMarketIds.has(p.marketId)
        );

        // We don't want to exceed max positions, but we also want to manage existing bids.
        // So effectiveCount should track held positions + pending bids for *new* markets.
        // We calculate effective count based on held positions AND active orders for current markets.
        const marketsWithOrders = new Set(activeOrders.map(o => o.marketId));
        const occupiedMarkets = new Set([...executedHoldings, ...marketsWithOrders]);
        let effectiveCount = occupiedMarkets.size;

        // --- LIMIT ENFORCEMENT ---
        // If we have reached the max positions, ensure no pending buy orders remain for *new* positions.
        // Note: executedHoldings tracks markets where we have a filled position.
        if (executedHoldings.size >= config.maxPositions) {
            const activeBuyOrders = activeOrders.filter(o => o.action === 'buy');

            if (activeBuyOrders.length > 0) {
                console.log(`[AUTO-BID] Max positions reached (${executedHoldings.size}/${config.maxPositions}). Cancelling ${activeBuyOrders.length} active buy orders.`);
                for (const o of activeBuyOrders) {
                    await orderManager.cancelOrder(o.id, true, true);
                    await new Promise(r => setTimeout(r, 200));
                }
                await refs.fetchPortfolio();
            }
            isAutoBidProcessing.current = false;
            return;
        }

        // --- DUPLICATE PROTECTION ---
        const orderMap = new Map();
        const duplicates = [];

        for (const o of activeOrders) {
            if (orderMap.has(o.marketId)) {
                duplicates.push(o);
            } else {
                orderMap.set(o.marketId, o);
            }
        }

        if (duplicates.length > 0) {
            console.log("[AUTO-BID] Cleaning up duplicates...", duplicates);
            for (const d of duplicates) {
                await orderManager.cancelOrder(d.id, true, true);
                await new Promise(r => setTimeout(r, 100));
            }
            await refs.fetchPortfolio();
            return; // Exit to let state settle
        }
        // ---------------------------

        const activeOrderTickers = new Set(activeOrders.map(o => o.marketId));

        // --- SPORT DIVERSIFICATION CHECK ---
        // Count positions per sport to prevent correlation risk
        let positionsPerSport = {};
        if (config.enableSportDiversification) {
            for (const marketId of executedHoldings) {
                const market = markets.find(m => m.realMarketId === marketId);
                if (market && market.sport) {
                    positionsPerSport[market.sport] = (positionsPerSport[market.sport] || 0) + 1;
                }
            }
        }
        // ----------------------------------

        for (const m of markets) {
            if (!m.isMatchFound) continue;
            if (m.isInverse) continue; // Only place YES bids for simplicity
            if (deselectedMarketIds.has(m.id)) continue;
            if (m.fairValue < config.minFairValue) continue;

            // --- LIQUIDITY CHECKS ---
            // Check if market has sufficient liquidity to ensure we can exit when needed
            if (config.enableLiquidityChecks) {
                // Check 1: Total volume (contracts traded)
                if (m.volume && m.volume < config.minLiquidity) {
                    console.log(`[AUTO-BID] Skipping ${m.realMarketId}: Low volume (${m.volume} < ${config.minLiquidity})`);
                    continue;
                }

                // Check 2: Bid-Ask spread (tight spread = good liquidity)
                const spread = (m.bestAsk && m.bestBid) ? (m.bestAsk - m.bestBid) : 999;
                if (spread > config.maxBidAskSpread) {
                    console.log(`[AUTO-BID] Skipping ${m.realMarketId}: Wide spread (${spread}¢ > ${config.maxBidAskSpread}¢)`);
                    continue;
                }
            }
            // -------------------------

            // --- SPORT DIVERSIFICATION CHECK ---
            // Prevent too many positions in a single sport (correlation risk)
            if (config.enableSportDiversification && m.sport) {
                const sportCount = positionsPerSport[m.sport] || 0;
                if (sportCount >= config.maxPositionsPerSport && !executedHoldings.has(m.realMarketId)) {
                    console.log(`[AUTO-BID] Skipping ${m.realMarketId}: Sport limit reached (${sportCount}/${config.maxPositionsPerSport} in ${m.sport})`);
                    continue;
                }
            }
            // --------------------------------------

            // --- VISIBILITY SAFEGUARD ---
            // Ensure market is still in the active 'markets' list and not deselected in the latest state.
            // This prevents bidding on stale markets if the user switches sports or deselects during async processing.
            const isStillDisplayed = latestMarketsRef.current.some(lm => lm.id === m.id);
            const isNowDeselected = latestDeselectedRef.current.has(m.id);

            if (!isStillDisplayed || isNowDeselected) {
                if (autoBidTracker.current.has(m.realMarketId)) autoBidTracker.current.delete(m.realMarketId);
                continue;
            }
            // ----------------------------

            // Check for held position
            if (executedHoldings.has(m.realMarketId)) {
                if (autoBidTracker.current.has(m.realMarketId)) autoBidTracker.current.delete(m.realMarketId);
                continue;
            }

            // --- STALE DATA PROTECTION ---
            // We check if our data fetch is recent. We rely on the API to give us current snapshot.
            // We also check if the bookmaker data is extremely old (> 60 mins) to catch stuck feeds.
            const isFetchStale = (Date.now() - lastFetchTimeRef.current) > STALE_DATA_THRESHOLD;
            const isDataAncient = (Date.now() - m.oddsLastUpdate) > (60 * 60 * 1000);

            if (isFetchStale || isDataAncient) {
                // Check if we have an active order to cancel
                const existingOrder = activeOrders.find(o => o.marketId === m.realMarketId);
                if (existingOrder) {
                    const reason = isFetchStale ? `Fetch stale (${formatDuration(Date.now() - lastFetchTimeRef.current)})` : `Data ancient (${formatDuration(Date.now() - m.oddsLastUpdate)})`;
                    console.log(`[AUTO-BID] Cancelling order ${m.realMarketId} due to stale data: ${reason}`);
                    addLog(`Cancelling bid ${m.realMarketId}: ${isFetchStale ? 'Fetch Stale' : 'Data Ancient'}`, 'CANCEL');
                    autoBidTracker.current.add(m.realMarketId);
                    await orderManager.cancelOrder(existingOrder.id, true);
                    await new Promise(r => setTimeout(r, 200));
                }
                continue; // Skip bidding on stale data
            }
            // -----------------------------

            const existingOrder = activeOrders.find(o => o.marketId === m.realMarketId);

            if (existingOrder && autoBidTracker.current.has(m.realMarketId)) {
                autoBidTracker.current.delete(m.realMarketId);
            }

            // Prevent race condition if we are already acting on this market
            if (autoBidTracker.current.has(m.realMarketId)) continue;

            const { smartBid, maxWillingToPay } = calculateStrategy(m, config.marginPercent);

            if (existingOrder) {
                // 1. Check if order is stale or bad
                if (smartBid === null || smartBid > maxWillingToPay) {
                    // Strategy says don't bid (loss of edge), but we have an order. Cancel it.
                    console.log(`[AUTO-BID] Cancelling stale/bad order ${m.realMarketId} (Bid: ${existingOrder.price}, Max: ${maxWillingToPay})`);
                    autoBidTracker.current.add(m.realMarketId);
                    await orderManager.cancelOrder(existingOrder.id, true);
                    await new Promise(r => setTimeout(r, 200)); // Delay
                    continue;
                }

                if (existingOrder.price !== smartBid) {
                    // Price improvement or adjustment needed
                    console.log(`[AUTO-BID] Updating ${m.realMarketId}: ${existingOrder.price}¢ -> ${smartBid}¢`);
                    addLog(`Updating bid ${m.realMarketId}: ${existingOrder.price}¢ -> ${smartBid}¢`, 'UPDATE');
                    autoBidTracker.current.add(m.realMarketId);

                    // Cancel then Place
                    try {
                        await orderManager.cancelOrder(existingOrder.id, true);
                        await new Promise(r => setTimeout(r, 200)); // Delay
                        await orderManager.executeOrder(m, smartBid, false, null, 'auto');
                        await new Promise(r => setTimeout(r, 200)); // Delay
                    } catch (e) {
                        console.error("Update failed", e);
                        autoBidTracker.current.delete(m.realMarketId);
                    }
                }
                // Else: Order is good, do nothing.
                continue;
            }

            // New Bid Logic
            if (effectiveCount >= config.maxPositions) continue;

            // Check if we already have an active order (should be covered by existingOrder check, but double check)
            if (activeOrderTickers.has(m.realMarketId)) continue;

            if (smartBid && smartBid <= maxWillingToPay) {
                console.log(`[AUTO-BID] New Bid ${m.realMarketId} @ ${smartBid}¢`);
                effectiveCount++;

                // Update sport counter for diversification tracking
                if (config.enableSportDiversification && m.sport) {
                    positionsPerSport[m.sport] = (positionsPerSport[m.sport] || 0) + 1;
                }

                autoBidTracker.current.add(m.realMarketId);
                await orderManager.executeOrder(m, smartBid, false, null, 'auto');
                await new Promise(r => setTimeout(r, 200)); // Delay
            }
        }
    } finally {
        isAutoBidProcessing.current = false;
    }
}
