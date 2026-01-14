// bot/orderManager.js
// Order execution and cancellation logic extracted from App.jsx

import { signRequest } from '../utils/core.js';

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
     * @param {Function} setTradeHistory - Callback to update trade history
     * @returns {Promise<void>}
     */
    async function executeOrder(marketOrTicker, price, isSell, qtyOverride, source = 'manual', setTradeHistory) {
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

    return {
        executeOrder,
        cancelOrder
    };
}
