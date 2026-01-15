// bot/autoClose.js
// Auto-close bot logic extracted from App.jsx

import { calculateKalshiFees } from '../utils/core.js';

/**
 * Runs the auto-close bot logic
 * @param {Object} params - Parameters for auto-close
 * @param {Array} params.markets - Current market data
 * @param {Array} params.positions - Current positions and orders
 * @param {Object} params.config - Bot configuration
 * @param {Object} params.tradeHistory - Trade history for tracking bot-opened positions
 * @param {Object} params.refs - React refs for tracking state
 * @param {Object} params.orderManager - Order management functions
 * @param {Function} params.addLog - Logging function
 * @returns {Promise<void>}
 */
export async function runAutoClose(params) {
    const {
        markets,
        positions,
        config,
        tradeHistory,
        refs,
        orderManager,
        addLog
    } = params;

    const { closingTracker } = refs;

    const heldPositions = positions.filter(p =>
        !p.isOrder &&
        p.status === 'HELD' &&
        p.quantity > 0 &&
        p.settlementStatus !== 'settled'
    );

    const activeSellOrders = positions.filter(p =>
        p.isOrder &&
        ['active', 'resting', 'pending'].includes(p.status.toLowerCase()) &&
        p.action === 'sell'
    );

    console.log(`[AUTO-CLOSE] Running with ${heldPositions.length} held positions, ${activeSellOrders.length} active sell orders`);

    for (const pos of heldPositions) {
        if (closingTracker.current.has(pos.marketId)) continue;

        // Check 1: Must be opened by bot (in tradeHistory)
        const history = tradeHistory[pos.marketId];
        if (!history) {
            console.log(`[AUTO-CLOSE] Skipping ${pos.marketId}: Not in trade history (not opened by bot)`);
            continue;
        }

        // Find current market data
        const m = markets.find(x => x.realMarketId === pos.marketId);
        if (!m) {
            console.log(`[AUTO-CLOSE] Skipping ${pos.marketId}: Market not found in current markets list (check sport filter)`);
            continue;
        }

        // Determine Target Price (Fair Value)
        // If we hold 'No' (isInverse), fairValue (from Odds API) is for the Target (which is No).
        // So m.fairValue is correct for the 'No' contract too.
        let fairValue = m.fairValue;
        fairValue = Math.max(1, fairValue); // Safety floor

        // Calculate Break-Even Price including Fees
        const buyPrice = pos.avgPrice || 0;
        let minSellPrice = Math.floor(buyPrice) + 1;

        // Find minimum price where (Price * Qty) - (Cost) - Fees > 0
        while (minSellPrice < 100) {
            const estimatedFees = calculateKalshiFees(minSellPrice, pos.quantity);
            const revenue = minSellPrice * pos.quantity;
            const cost = buyPrice * pos.quantity;
            if (revenue - cost - estimatedFees > 0) break;
            minSellPrice++;
        }

        // Set Target Price: Must be at least minSellPrice (to ensure profit)
        // But if Fair Value is higher, take the extra profit.
        let basePrice = Math.max(fairValue, minSellPrice);

        // Apply user-defined Auto-Close margin
        let targetPrice = Math.floor(basePrice * (1 + config.autoCloseMarginPercent / 100));

        if (targetPrice > 99) targetPrice = 99;

        // Check for existing active sell order
        const existingOrder = activeSellOrders.find(o => o.marketId === pos.marketId);

        if (existingOrder) {
            // If price mismatch, update it
            if (existingOrder.price !== targetPrice) {
                console.log(`[AUTO-CLOSE] Updating Sell Order ${pos.marketId}: ${existingOrder.price}¢ -> ${targetPrice}¢`);
                addLog(`Updating sell ${pos.marketId}: ${existingOrder.price}¢ -> ${targetPrice}¢`, 'UPDATE');
                closingTracker.current.add(pos.marketId);
                try {
                    await orderManager.cancelOrder(existingOrder.id, true);
                    await new Promise(r => setTimeout(r, 200));
                    await orderManager.executeOrder(m, targetPrice, true, pos.quantity, 'auto');
                    await new Promise(r => setTimeout(r, 200));
                } catch (e) {
                    console.error("AutoClose Update Failed", e);
                } finally {
                    closingTracker.current.delete(pos.marketId);
                }
            }
            // Else: Order is good (priced at Fair Value), do nothing.
        } else {
            // No active order, place it
            console.log(`[AUTO-CLOSE] Offering ${pos.marketId} @ ${targetPrice}¢ (Fair Value)`);
            closingTracker.current.add(pos.marketId);
            try {
                await orderManager.executeOrder(m, targetPrice, true, pos.quantity, 'auto');
                await new Promise(r => setTimeout(r, 200));
            } catch (e) {
                console.error("AutoClose Placement Failed", e);
            } finally {
                closingTracker.current.delete(pos.marketId);
            }
        }
    }
}
