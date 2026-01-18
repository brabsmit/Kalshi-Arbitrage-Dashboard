// bot/orderManager.js
// Order execution and cancellation logic extracted from App.jsx

import { signRequest } from '../utils/core.js';
import KalshiMath from '../utils/KalshiMath.js';

/**
 * Creates an order manager that handles Kalshi order operations
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.walletKeys - Kalshi API credentials
 * @param {Function} dependencies.fetchPortfolio - Callback to refresh portfolio
 * @param {Function} dependencies.addLog - Callback to log events
 * @param {Function} dependencies.setIsRunning - Callback to stop bot on critical errors
 * @param {Function} dependencies.setErrorMsg - Callback to set error message
 * @param {Function} dependencies.setIsWalletOpen - Callback to open wallet modal
 * @param {Function} dependencies.setActiveAction - Callback to show active action in UI
 * @param {Function} dependencies.setTradeHistory - Callback to update trade history
 * @param {Function} dependencies.setPositions - Callback to optimistically update positions
 * @param {Object} dependencies.config - Bot configuration
 * @param {Object} dependencies.trackers - Ref objects for tracking state
 * @returns {Object} Order management functions
 */
export function createOrderManager(dependencies) {
    const {
        walletKeys,
        fetchPortfolio,
        addLog,
        setIsRunning,
        setErrorMsg,
        setIsWalletOpen,
        setActiveAction,
        setTradeHistory,
        setPositions,
        config,
        trackers
    } = dependencies;

    /**
     * Execute a buy or sell order on Kalshi
     * @param {Object|string} marketOrTicker - Market object or ticker string
     * @param {number} price - Order price in cents
     * @param {boolean} isSell - True for sell, false for buy
     * @param {number|null} qtyOverride - Optional quantity override
     * @param {string} source - Order source ('manual' or 'auto')
     * @returns {Promise<void>}
     */
    async function executeOrder(marketOrTicker, price, isSell, qtyOverride, source = 'manual') {
        if (!walletKeys) {
            setIsWalletOpen(true);
            return;
        }

        const ticker = isSell ? (marketOrTicker.realMarketId || marketOrTicker) : marketOrTicker.realMarketId;
        const qty = qtyOverride || config.tradeSize;

        // Determine side for order
        let side = 'yes';
        // If the market object is passed (has isInverse), use it to determine side
        if (marketOrTicker.isInverse) {
            side = 'no';
        }

        if (source !== 'manual') {
            setActiveAction({ type: isSell ? 'CLOSE' : 'BID', ticker, price });
            setTimeout(() => setActiveAction(null), 3000);
        }

        try {
            const ts = Date.now();
            const effectivePrice = isSell ? (price || 1) : price;

            const orderParams = {
                action: isSell ? 'sell' : 'buy',
                ticker,
                count: qty,
                type: 'limit',
                side: side,
            };

            if (side === 'yes') {
                orderParams.yes_price = effectivePrice;
            } else {
                orderParams.no_price = effectivePrice;
            }

            const body = JSON.stringify(orderParams);
            const sig = await signRequest(walletKeys.privateKey, "POST", '/trade-api/v2/portfolio/orders', ts);

            const res = await fetch('/api/kalshi/portfolio/orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'KALSHI-ACCESS-KEY': walletKeys.keyId,
                    'KALSHI-ACCESS-SIGNATURE': sig,
                    'KALSHI-ACCESS-TIMESTAMP': ts.toString()
                },
                body
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Order Failed");

            console.log(`Order Placed: ${data.order_id}`);

            if (isSell) {
                addLog(`Closing position on ${ticker} (Qty: ${qty})`, 'CLOSE');
            } else {
                const mktId = marketOrTicker.realMarketId || marketOrTicker.id;
                addLog(`Placed bid on ${mktId} @ ${price}¢ (Qty: ${qty}) [Side: ${side}]`, 'BID');
            }

            if (!isSell) {
                trackers.autoBidTracker.current.add(ticker);
                setTradeHistory(prev => ({
                    ...prev,
                    [ticker]: {
                        ticker,
                        orderId: data.order_id,
                        event: marketOrTicker.event,
                        oddsTime: marketOrTicker.lastChange,
                        orderPlacedAt: Date.now(),
                        sportsbookOdds: marketOrTicker.sportsbookOdds,
                        opposingOdds: marketOrTicker.opposingOdds,
                        oddsDisplay: marketOrTicker.oddsDisplay,
                        vigFreeProb: marketOrTicker.vigFreeProb,
                        fairValue: marketOrTicker.fairValue,
                        bidPrice: price,
                        bookmakerCount: marketOrTicker.bookmakerCount,
                        oddsSpread: marketOrTicker.oddsSpread,
                        source: source
                    }
                }));

                // OPTIMIZATION: Optimistic position tracking
                // Check if order filled immediately (fill_count > 0)
                if (data.order && data.order.fill_count > 0 && setPositions) {
                    console.log(`[OPTIMISTIC] Order ${data.order_id} filled ${data.order.fill_count}/${qty} immediately`);

                    // Add optimistic position immediately (don't wait for 5s portfolio poll)
                    setPositions(prev => {
                        // Check if position already exists
                        const existingPosition = prev.find(p => !p.isOrder && p.marketId === ticker && !p._optimistic);

                        if (existingPosition) {
                            // Position already exists (from previous fill), don't add optimistic
                            return prev;
                        }

                        // Add optimistic position
                        const optimisticPosition = {
                            id: `${ticker}-optimistic-${Date.now()}`,
                            marketId: ticker,
                            side: side === 'yes' ? 'Yes' : 'No',
                            quantity: data.order.fill_count,
                            avgPrice: effectivePrice,
                            cost: data.order.fill_count * effectivePrice,
                            fees: 0, // Will be updated by portfolio poll
                            status: 'HELD',
                            isOrder: false,
                            settlementStatus: 'unsettled',
                            _optimistic: true,
                            _optimisticTimestamp: Date.now()
                        };

                        console.log(`[OPTIMISTIC] Added optimistic position for ${ticker} (qty: ${data.order.fill_count})`);
                        return [...prev, optimisticPosition];
                    });
                }
            }
            fetchPortfolio();
        } catch (e) {
            console.error(e);

            if (isSell) trackers.closingTracker.current.delete(ticker);
            else trackers.autoBidTracker.current.delete(ticker);

            if (e.message && e.message.toLowerCase().includes("insufficient funds")) {
                setIsRunning(false);
                setErrorMsg(`CRITICAL ERROR: ${e.message} - Bot Stopped.`);
                addLog(`Critical Error: ${e.message}`, 'ERROR');
                throw e;
            }

            if (!config.isAutoBid && !config.isAutoClose) alert(e.message);
        }
    }

    /**
     * Cancel an existing order
     * @param {string} id - Order ID to cancel
     * @param {boolean} skipConfirm - Skip confirmation dialog
     * @param {boolean} skipRefresh - Skip portfolio refresh after cancel
     * @returns {Promise<void>}
     */
    async function cancelOrder(id, skipConfirm = false, skipRefresh = false) {
        if (!skipConfirm && !confirm("Cancel Order?")) return;

        const ts = Date.now();
        const sig = await signRequest(walletKeys.privateKey, "DELETE", `/trade-api/v2/portfolio/orders/${id}`, ts);
        const res = await fetch(`/api/kalshi/portfolio/orders/${id}`, {
            method: 'DELETE',
            headers: {
                'KALSHI-ACCESS-KEY': walletKeys.keyId,
                'KALSHI-ACCESS-SIGNATURE': sig,
                'KALSHI-ACCESS-TIMESTAMP': ts.toString()
            }
        });

        if (res.ok) {
            addLog(`Canceled order ${id}`, 'CANCEL');
        } else if (res.status === 404) {
            console.warn(`Order ${id} not found during cancellation (likely already filled/cancelled).`);
            addLog(`Cancel skipped: Order ${id} already gone`, 'CANCEL');
        } else {
            const err = await res.json();
            console.error("Cancel failed:", err);
            throw new Error(err.message || "Cancel Failed");
        }

        if (!skipRefresh) fetchPortfolio();
    }

    /**
     * Executes a "Bail Out" Sell Order using IOC (Immediate or Cancel).
     * Sells INTO the bid to exit immediately.
     * @param {string} ticker - The market ticker
     * @param {number} bidPrice - The current best Bid price in cents
     * @param {number} quantity - Number of contracts to sell
     * @param {string} side - 'yes' or 'no'
     * @returns {Promise<{success: boolean, filled: number}>}
     */
    async function executeBailOutOrder(ticker, bidPrice, quantity, side) {
        if (!walletKeys) return { success: false, filled: 0 };

        try {
            const ts = Date.now();
            const orderParams = {
                ticker: ticker,
                action: 'sell',
                type: 'limit',
                price: bidPrice,
                count: quantity,
                time_in_force: 'ioc',
                client_order_id: `bailout-${ts}-${Math.random().toString(36).substr(2, 5)}`,
                side: side // 'yes' or 'no'
            };

            const body = JSON.stringify(orderParams);
            const sig = await signRequest(walletKeys.privateKey, "POST", '/trade-api/v2/portfolio/orders', ts);

            console.log(`[BAILOUT] Firing IOC Sell: ${quantity}x ${ticker} @ ${bidPrice}¢`);
            addLog(`Bail Out: ${ticker} @ ${bidPrice}¢`, 'CLOSE');

            const res = await fetch('/api/kalshi/portfolio/orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'KALSHI-ACCESS-KEY': walletKeys.keyId,
                    'KALSHI-ACCESS-SIGNATURE': sig,
                    'KALSHI-ACCESS-TIMESTAMP': ts.toString()
                },
                body
            });

            const data = await res.json();
            if (res.ok && data.order) {
                const filled = data.order.filled_count || 0;
                if (filled > 0) {
                     fetchPortfolio();
                     return { success: true, filled };
                }
            }
            return { success: false, filled: 0 };

        } catch (e) {
            console.error(`[BAILOUT ERROR] Failed to liquidate ${ticker}:`, e);
            return { success: false, filled: 0 };
        }
    }

    /**
     * Executes an aggressive Taker Buy order using IOC (Immediate or Cancel).
     * Performs a pre-flight check to ensure Taker fees don't destroy the edge.
     * @param {string} ticker - The market ticker (e.g., 'KX-NFL-24-W1')
     * @param {number} askPriceCents - The current best Ask price in cents (1-99)
     * @param {number} quantity - Desired number of contracts
     * @param {number} fairValueCents - The calculated Fair Value from Odds API
     * @returns {Promise<{success: boolean, filled: number, reason: string}>}
     */
    async function executeTakerOrder(ticker, askPriceCents, quantity, fairValueCents) {
        if (!walletKeys) {
            console.error("[Exec] Missing wallet keys");
            return { success: false, filled: 0, reason: 'No wallet keys' };
        }

        // 1. Calculate Exact Taker Fee using our helper class
        const totalFeeCents = KalshiMath.calculateFee(askPriceCents, quantity, true); // true = isTaker
        const feePerContract = totalFeeCents / quantity;

        // 2. Calculate "Effective Entry Price" (Price + Fee)
        // We use floating point here for precision comparison, but logic remains cent-based
        const effectiveCost = askPriceCents + feePerContract;

        // 3. Profitability Guard Rail
        // If our cost (including fees) is higher than the fair value, ABORT.
        // We want at least 1 cent of clearance *after* fees.
        if (effectiveCost >= fairValueCents) {
            console.warn(`[Risk] Taker trade aborted. Cost ${effectiveCost.toFixed(3)} > FV ${fairValueCents}`);
            return { success: false, filled: 0, reason: 'Negative Expected Value after Fees' };
        }

        // 4. Execute IOC Order
        try {
            const ts = Date.now();
            const orderParams = {
                ticker: ticker,
                action: 'buy',
                type: 'limit',       // We use limit to specify the MAX price we are willing to pay
                price: askPriceCents, // We buy AT the ask (or better)
                count: quantity,
                time_in_force: 'ioc', // CRITICAL: Immediate or Cancel
                client_order_id: `taker-${ts}-${Math.random().toString(36).substr(2, 5)}`,
                side: 'yes' // Default to yes (buying the outcome)
            };

            // Sign and Send
            const body = JSON.stringify(orderParams);
            const sig = await signRequest(walletKeys.privateKey, "POST", '/trade-api/v2/portfolio/orders', ts);

            console.log(`[Exec] Firing Taker Order: ${quantity}x ${ticker} @ ${askPriceCents}¢ (FV: ${fairValueCents})`);

            const res = await fetch('/api/kalshi/portfolio/orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'KALSHI-ACCESS-KEY': walletKeys.keyId,
                    'KALSHI-ACCESS-SIGNATURE': sig,
                    'KALSHI-ACCESS-TIMESTAMP': ts.toString()
                },
                body
            });

            const data = await res.json();

            // 5. Handle Response
            if (res.ok && data.order) {
                const filled = data.order.filled_count || 0;
                // Log success/partial
                if (filled > 0) {
                    addLog(`Taker Fill: ${ticker} x${filled} @ ${askPriceCents}¢`, 'EXEC');

                    // Optimistic update
                    if (setPositions) {
                         setPositions(prev => [...prev, {
                             id: `${ticker}-taker-${Date.now()}`,
                             marketId: ticker,
                             side: 'Yes',
                             quantity: filled,
                             avgPrice: askPriceCents,
                             cost: filled * askPriceCents,
                             fees: totalFeeCents * (filled/quantity), // Approximate proportional fee
                             status: 'HELD',
                             isOrder: false,
                             settlementStatus: 'unsettled',
                             _optimistic: true
                         }]);
                    }

                    fetchPortfolio(); // Refresh portfolio
                    return { success: true, filled: filled, reason: 'Filled' };
                } else {
                    return { success: false, filled: 0, reason: 'IOC - No liquidity found' };
                }
            } else {
                console.error("Taker Order Failed:", data);
                return { success: false, filled: 0, reason: data.message || 'Unknown API Error' };
            }

        } catch (error) {
            console.error(`[Error] Taker Execution Failed: ${error.message}`);
            return { success: false, filled: 0, reason: error.message };
        }
    }

    return {
        executeOrder,
        cancelOrder,
        executeTakerOrder,
        executeBailOutOrder
    };
}
