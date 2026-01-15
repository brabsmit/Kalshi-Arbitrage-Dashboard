// bot/autoBid.js
// Auto-bid bot logic extracted from App.jsx

import { calculateStrategy, formatDuration } from '../utils/core.js';

// Constants
const STALE_DATA_THRESHOLD = 30000; // 30 seconds
const MAX_POSITIONS_PER_TICKER = 1; // Maximum number of position entries allowed per ticker

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

        // FIX: Track total positions per ticker to prevent accumulating excessive positions
        // Group positions by ticker and count total entries (not just unique tickers)
        const positionsPerTicker = new Map();
        positions.filter(p =>
            !p.isOrder &&
            p.quantity > 0 &&
            p.settlementStatus !== 'settled' &&
            currentMarketIds.has(p.marketId)
        ).forEach(p => {
            const count = positionsPerTicker.get(p.marketId) || 0;
            positionsPerTicker.set(p.marketId, count + 1);
        });

        const executedHoldings = new Set(positionsPerTicker.keys());

        // DIAGNOSTIC: Check for excessive positions per ticker (bug detection)
        for (const [ticker, count] of positionsPerTicker.entries()) {
            if (count > MAX_POSITIONS_PER_TICKER) {
                console.error(`[AUTO-BID] ALERT: Found ${count} position entries for ${ticker} (limit: ${MAX_POSITIONS_PER_TICKER}). This indicates the bug occurred previously.`);
                addLog(`⚠️ ALERT: ${ticker} has ${count} positions (exceeds limit)`, 'ERROR');
            }
        }

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
                    await new Promise(r => setTimeout(r, 100)); // OPTIMIZATION: Reduced from 200ms
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

        // OPTIMIZATION: Priority-Based Order Queue
        // Sort markets by edge (fairValue - bestBid) to process high-edge opportunities first
        // This ensures that even if bot is slow, we capture the best opportunities
        const sortedMarkets = [...markets].sort((a, b) => {
            const edgeA = (a.fairValue || 0) - (a.bestBid || 0);
            const edgeB = (b.fairValue || 0) - (b.bestBid || 0);
            return edgeB - edgeA; // Descending order (highest edge first)
        });

        for (const m of sortedMarkets) {
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

            // Check for held position - now with per-ticker limit enforcement
            const tickerPositionCount = positionsPerTicker.get(m.realMarketId) || 0;
            if (tickerPositionCount > 0) {
                // We have at least one position on this ticker
                if (tickerPositionCount >= MAX_POSITIONS_PER_TICKER) {
                    // Exceeded per-ticker limit - cancel any pending orders
                    const pendingOrder = activeOrders.find(o => o.marketId === m.realMarketId && o.action === 'buy');
                    if (pendingOrder) {
                        console.log(`[AUTO-BID] Per-ticker limit reached for ${m.realMarketId} (${tickerPositionCount} positions). Cancelling pending order.`);
                        addLog(`Cancelling ${m.realMarketId}: ${tickerPositionCount} positions (limit: ${MAX_POSITIONS_PER_TICKER})`, 'CANCEL');
                        await orderManager.cancelOrder(pendingOrder.id, true, true);
                        await new Promise(r => setTimeout(r, 100)); // OPTIMIZATION: Reduced from 200ms
                    }
                }
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
                    await new Promise(r => setTimeout(r, 100)); // OPTIMIZATION: Reduced from 200ms
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
                    await new Promise(r => setTimeout(r, 100)); // OPTIMIZATION: Reduced from 200ms // Delay
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
                        await new Promise(r => setTimeout(r, 100)); // OPTIMIZATION: Reduced from 200ms // Delay
                        await orderManager.executeOrder(m, smartBid, false, null, 'auto');
                        await new Promise(r => setTimeout(r, 100)); // OPTIMIZATION: Reduced from 200ms // Delay
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

            // CRITICAL FIX: Check if we're already tracking this market to prevent race conditions
            if (autoBidTracker.current.has(m.realMarketId)) {
                console.log(`[AUTO-BID] Skipping ${m.realMarketId}: Already in tracker (preventing race condition)`);
                continue;
            }

            // CRITICAL FIX: Double-check we don't already have any positions on this ticker
            if (positionsPerTicker.has(m.realMarketId)) {
                console.log(`[AUTO-BID] Skipping ${m.realMarketId}: Already have ${positionsPerTicker.get(m.realMarketId)} position(s)`);
                continue;
            }

            if (smartBid && smartBid <= maxWillingToPay) {
                console.log(`[AUTO-BID] New Bid ${m.realMarketId} @ ${smartBid}¢ (Positions: ${tickerPositionCount || 0}, Orders: ${activeOrderTickers.has(m.realMarketId) ? 1 : 0})`);
                effectiveCount++;

                // Update sport counter for diversification tracking
                if (config.enableSportDiversification && m.sport) {
                    positionsPerSport[m.sport] = (positionsPerSport[m.sport] || 0) + 1;
                }

                // Add to tracker BEFORE placing order to prevent concurrent attempts
                autoBidTracker.current.add(m.realMarketId);

                try {
                    await orderManager.executeOrder(m, smartBid, false, null, 'auto');
                    await new Promise(r => setTimeout(r, 100)); // OPTIMIZATION: Reduced from 200ms // Delay
                } catch (e) {
                    // If order fails, remove from tracker
                    console.error(`[AUTO-BID] Order failed for ${m.realMarketId}:`, e);
                    autoBidTracker.current.delete(m.realMarketId);
                }
            }
        }
    } finally {
        isAutoBidProcessing.current = false;
    }
}
