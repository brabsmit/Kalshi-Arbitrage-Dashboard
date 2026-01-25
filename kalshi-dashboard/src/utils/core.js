// src/utils/core.js

// ==========================================
// FORMATTERS & ESCAPING
// ==========================================

export const formatDuration = (ms) => {
    if (!ms) return '-';
    const s = Math.abs(ms / 1000).toFixed(1);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
};

export const formatMoney = (val) => val ? `$${(val / 100).toFixed(2)}` : '$0.00';

export const formatOrderDate = (ts) => !ts ? '-' : new Date(ts).toLocaleString('en-US', {
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
});

export const formatGameTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
};

export const detectMarketType = (ticker) => {
    if (!ticker) return 'moneyline';
    if (/-[OU]\d+(\.\d+)?$/.test(ticker)) return 'totals';
    if (/-\d+(\.\d+)?$/.test(ticker)) return 'spreads';
    return 'moneyline';
};

export const extractLine = (ticker) => {
    if (!ticker) return null;
    const totalMatch = ticker.match(/-([OU]\d+(\.\d+)?)$/);
    if (totalMatch) return totalMatch[1];
    const spreadMatch = ticker.match(/-(\d+(\.\d+)?)$/);
    if (spreadMatch) return spreadMatch[1];
    return null;
};

// ==========================================
// MATH & STRATEGY
// ==========================================

export const americanToProbability = (odds) => {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
};

export const probabilityToAmericanOdds = (prob) => {
    if (prob <= 0 || prob >= 1) return 0;
    if (prob >= 0.5) {
        const odds = - (prob / (1 - prob)) * 100;
        return Math.round(odds);
    } else {
        const odds = ((1 - prob) / prob) * 100;
        return Math.round(odds);
    }
};

export const calculateVolatility = (history) => {
    if (!history || history.length < 2) return 0;
    let sum = 0;
    let sumSq = 0;
    const n = history.length;
    // Single pass O(N) loop to avoid array allocation and multiple traversals
    for (let i = 0; i < n; i++) {
        const v = history[i].v;
        sum += v;
        sumSq += v * v;
    }
    // Variance = (SumSq - (Sum*Sum)/N) / (N - 1)
    const variance = (sumSq - (sum * sum) / n) / (n - 1);
    return Math.sqrt(Math.max(0, variance));
};

export const calculateStrategy = (market, marginPercent) => {
    if (!market.isMatchFound) return { smartBid: null, reason: "No Market", edge: -100, maxWillingToPay: 0 };

    const fairValue = market.fairValue;

    // STRATEGY FIX: Volatility padding has been removed.
    // Previous logic increased margin during high volatility, but this was backwards:
    // - High volatility in sports betting indicates breaking news, injury reports, lineup changes
    // - These create the BEST arbitrage opportunities (books update at different speeds)
    // - Increasing margin during volatility meant AVOIDING the highest-edge trades
    // - In sports betting, unlike financial markets, volatility = opportunity, not risk
    //
    // New approach: Use base margin only. Volatility is now tracked for informational purposes
    // but does not affect position sizing or bid prices.
    const volatility = market.volatility || 0;
    const effectiveMargin = marginPercent; // Removed volatility padding: was marginPercent + (volatility * 0.25)

    const maxWillingToPay = Math.floor(fairValue * (1 - effectiveMargin / 100));
    const currentBestBid = market.bestBid || 0;
    const edge = fairValue - currentBestBid;

    // Dynamic bid increment based on edge size for more aggressive entry
    // Larger edges = jump ahead in queue, smaller edges = conservative +1¢
    let bidIncrement = 1;
    if (edge > 10) {
        bidIncrement = 3;  // Huge edge: jump 3¢ ahead
    } else if (edge > 5) {
        bidIncrement = 2;  // Good edge: jump 2¢ ahead
    }

    let smartBid = currentBestBid + bidIncrement;
    let reason = bidIncrement > 1 ? `Beat Market +${bidIncrement}¢` : "Beat Market";

    // Alpha Strategy: Crossing the Spread (with Fee Protection)
    // If the Best Ask is significantly below our fair value, we take liquidity immediately
    // instead of waiting as a maker. However, we must account for Kalshi taker fees.
    //
    // Kalshi Taker Fee: ~7% of payout = ceil(0.07 * qty * price * (1-price))
    // Example: Buying 10 contracts at 50¢ = ~$1.75 in fees = ~1.75¢ per contract
    //
    // STRATEGY UPDATE: Reduced buffer from 3¢ to 1¢ for more aggressive spread crossing.
    // - At 3¢ buffer: Too conservative, missed many profitable opportunities
    // - At 1¢ buffer: Still protects against fees while capturing more edges
    // - Allows more aggressive taker behavior when edge is clear
    const TAKER_FEE_BUFFER = 1;

    // Check if we can buy immediately at a significant discount (after accounting for fees)
    if (market.bestAsk > 0 && market.bestAsk <= (maxWillingToPay - TAKER_FEE_BUFFER)) {
        smartBid = market.bestAsk;
        reason = "Take Ask";
    }

    if (smartBid > maxWillingToPay) {
        smartBid = maxWillingToPay;
        reason = "Max Limit";
    }

    if (smartBid > 99) smartBid = 99;

    return { smartBid, maxWillingToPay, edge, reason };
};

export const calculateKalshiFees = (priceCents, quantity) => {
    // Formula from Fee Schedule (Taker): fees = ceil(0.07 * count * price_dollar * (1 - price_dollar))
    if (quantity <= 0) return 0;
    const p = priceCents / 100;
    const rawFee = 0.07 * quantity * p * (1 - p);
    return Math.ceil(rawFee * 100);
};

// ==========================================
// PORTFOLIO CALCULATIONS
// ==========================================

export const calculateUnrealizedPnL = (quantity, entryPrice, currentPrice) => {
    // Returns P&L in cents
    return quantity * (currentPrice - entryPrice);
};

export const calculateBreakEvenPrice = (entryPrice, quantity, feesPaid) => {
    // Calculate price needed to break even after fees
    // feesPaid is entry fees, we need to account for estimated exit fees too
    const estimatedExitFee = calculateKalshiFees(entryPrice, quantity);
    const totalFees = feesPaid + estimatedExitFee;
    const breakEven = Math.ceil(entryPrice + (totalFees / quantity));
    return Math.min(breakEven, 99); // Cap at Kalshi max
};

export const calculateHoldDuration = (entryTimestamp) => {
    if (!entryTimestamp) return null;
    return Date.now() - entryTimestamp;
};

export const formatHoldDuration = (ms) => {
    if (!ms || ms < 0) return '-';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
};

export const calculateEdge = (fairValue, price) => {
    // Positive edge = buying below FV or selling above FV
    return fairValue - price;
};

export const calculateDistanceFromMarket = (orderPrice, bestBid, bestAsk, isBuy) => {
    // For buy orders: distance from best ask (negative = below market)
    // For sell orders: distance from best bid (positive = above market)
    if (isBuy) {
        return orderPrice - (bestAsk || orderPrice);
    } else {
        return orderPrice - (bestBid || orderPrice);
    }
};

export const calculateTargetPnL = (position, exitPrice) => {
    // Calculate expected P&L if exit order fills
    const { quantity, avgPrice, fees } = position;
    const revenue = quantity * exitPrice;
    const cost = quantity * avgPrice;
    const exitFees = calculateKalshiFees(exitPrice, quantity);
    return revenue - cost - fees - exitFees;
};

export const formatPercentReturn = (pnl, cost) => {
    if (!cost || cost === 0) return '-';
    const percent = (pnl / cost) * 100;
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
};

// ==========================================
// SESSION ANALYTICS
// ==========================================

export const calculateSessionMetrics = (positions, tradeHistory) => {
    const metrics = {
        // Basic counts
        totalTrades: 0,
        settledTrades: 0,
        pendingTrades: 0,
        cancelledOrders: 0,

        // P&L metrics
        totalRealizedPnL: 0,
        totalUnrealizedPnL: 0,
        grossProfit: 0,
        grossLoss: 0,
        totalFees: 0,
        netPnL: 0,

        // Win/Loss tracking
        wins: 0,
        losses: 0,
        breakevens: 0,
        winRate: 0,

        // Best/Worst trades
        bestTrade: null,
        worstTrade: null,
        largestWin: 0,
        largestLoss: 0,

        // Edge analysis
        totalEntryEdge: 0,
        avgEntryEdge: 0,
        totalExitEdge: 0,
        avgExitEdge: 0,
        edgeCaptureRate: 0,

        // Hold time analysis
        totalHoldTime: 0,
        avgHoldTime: 0,
        minHoldTime: Infinity,
        maxHoldTime: 0,

        // Exposure metrics
        maxExposure: 0,
        avgExposure: 0,
        currentExposure: 0,

        // Risk metrics
        sharpeRatio: 0,
        maxDrawdown: 0,
        volatility: 0,

        // Market metrics
        uniqueMarkets: 0,
        sportBreakdown: {},

        // Execution metrics
        fillRate: 0,
        spreadCrossRate: 0,
        avgQueueTime: 0
    };

    // ⚡ Bolt Optimization: Removed all intermediate arrays (O(1) memory usage)
    let sumSqPnl = 0;
    let cumulativePnL = 0;
    let peakPnL = 0;
    let totalSettledCost = 0;

    let entryEdgeCount = 0;
    let exitEdgeCount = 0;
    let holdTimeCount = 0;

    const markets = new Set();
    const sports = {};

    // Process all positions
    for (const p of positions) {
        const historyEntry = tradeHistory[p.marketId];

        if (!p.isOrder && historyEntry && historyEntry.source === 'auto') {
            metrics.totalTrades++;
            markets.add(p.marketId);

            // Sport breakdown
            const sport = historyEntry.event?.split(' ')[0] || 'Unknown';
            sports[sport] = (sports[sport] || 0) + 1;

            // Entry edge
            if (historyEntry.fairValue && p.avgPrice) {
                const entryEdge = historyEntry.fairValue - p.avgPrice;
                metrics.totalEntryEdge += entryEdge;
                entryEdgeCount++;
            }

            if (p.settlementStatus === 'settled' || p.realizedPnl !== undefined) {
                // Settled trade
                metrics.settledTrades++;
                const pnl = p.realizedPnl || 0;
                metrics.totalRealizedPnL += pnl;

                // ⚡ Bolt Optimization: Single-pass Variance and Drawdown calculation
                sumSqPnl += pnl * pnl;

                cumulativePnL += pnl;
                if (cumulativePnL > peakPnL) {
                    peakPnL = cumulativePnL;
                }
                const drawdown = peakPnL - cumulativePnL;
                if (drawdown > metrics.maxDrawdown) {
                    metrics.maxDrawdown = drawdown;
                }

                if (pnl > 0) {
                    metrics.wins++;
                    metrics.grossProfit += pnl;
                    if (pnl > metrics.largestWin) {
                        metrics.largestWin = pnl;
                        metrics.bestTrade = p;
                    }
                } else if (pnl < 0) {
                    metrics.losses++;
                    metrics.grossLoss += Math.abs(pnl);
                    if (pnl < metrics.largestLoss) {
                        metrics.largestLoss = pnl;
                        metrics.worstTrade = p;
                    }
                } else {
                    metrics.breakevens++;
                }

                // Hold time
                if (historyEntry.orderPlacedAt && p.settled) {
                    const holdTime = p.settled - historyEntry.orderPlacedAt;
                    metrics.totalHoldTime += holdTime;
                    holdTimeCount++;
                    metrics.minHoldTime = Math.min(metrics.minHoldTime, holdTime);
                    metrics.maxHoldTime = Math.max(metrics.maxHoldTime, holdTime);
                }

                // Exit edge (if we have exit price)
                if (p.payout && p.quantity) {
                    const exitPrice = Math.floor(p.payout / p.quantity);
                    const exitFV = historyEntry.fairValue; // Approximate, should track actual FV at exit
                    if (exitFV) {
                        const exitEdge = exitPrice - exitFV;
                        metrics.totalExitEdge += exitEdge;
                        exitEdgeCount++;
                    }
                }

                // Fees
                if (p.fees) {
                    metrics.totalFees += p.fees;
                }

                totalSettledCost += (p.cost || 0);
            } else {
                // Active/pending trade
                metrics.pendingTrades++;
                // activePositions not used

                // Current exposure
                if (p.cost) {
                    metrics.currentExposure += p.cost;
                }
            }
        }
    }

    // Calculate averages
    if (entryEdgeCount > 0) {
        metrics.avgEntryEdge = metrics.totalEntryEdge / entryEdgeCount || 0;
    }

    if (exitEdgeCount > 0) {
        metrics.avgExitEdge = metrics.totalExitEdge / exitEdgeCount;
    }

    if (holdTimeCount > 0) {
        metrics.avgHoldTime = metrics.totalHoldTime / holdTimeCount;
    }

    if (metrics.minHoldTime === Infinity) {
        metrics.minHoldTime = 0;
    }

    // Win rate
    if (metrics.settledTrades > 0) {
        metrics.winRate = (metrics.wins / metrics.settledTrades) * 100;
    }

    // Edge capture rate
    if (metrics.avgEntryEdge > 0) {
        const avgRealizedEdge = metrics.settledTrades > 0 ? (metrics.totalRealizedPnL / metrics.settledTrades) / 10 : 0; // Convert cents to cents per contract
        metrics.edgeCaptureRate = (avgRealizedEdge / metrics.avgEntryEdge) * 100;
    }

    // Net P&L
    metrics.netPnL = metrics.totalRealizedPnL - metrics.totalFees;

    // Sharpe Ratio (annualized, assuming independent trades)
    if (metrics.settledTrades >= 2) {
        const n = metrics.settledTrades;
        const mean = metrics.totalRealizedPnL / n;

        // Variance = (SumSq - (Sum*Sum)/N) / (N - 1)
        const variance = (sumSqPnl - (metrics.totalRealizedPnL * metrics.totalRealizedPnL) / n) / (n - 1);
        const stdDev = Math.sqrt(Math.max(0, variance)); // Clamp to 0 to avoid NaN
        metrics.volatility = stdDev;

        if (stdDev > 0) {
            // Sharpe = (mean return) / (std dev of returns)
            // Annualize assuming ~100 trades per year for sports betting
            const tradesPerYear = 100;
            metrics.sharpeRatio = (mean / stdDev) * Math.sqrt(tradesPerYear);
        }
    }

    // Unique markets and sports
    metrics.uniqueMarkets = markets.size;
    metrics.sportBreakdown = sports;

    // ROI
    metrics.roi = totalSettledCost > 0 ? (metrics.totalRealizedPnL / totalSettledCost) * 100 : 0;

    return metrics;
};

// ==========================================
// CRYPTO
// ==========================================

let cachedKeyPem = null;
let cachedForgeKey = null;

export const signRequest = async (privateKeyPem, method, path, timestamp) => {
    try {
        const forge = window.forge;
        if (!forge) throw new Error("Forge library not loaded");

        // Simple cache to avoid parsing PEM on every request
        let privateKey;
        if (cachedKeyPem === privateKeyPem && cachedForgeKey) {
            privateKey = cachedForgeKey;
        } else {
            privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
            cachedKeyPem = privateKeyPem;
            cachedForgeKey = privateKey;
        }

        const md = forge.md.sha256.create();
        const cleanPath = path.split('?')[0];
        const message = `${timestamp}${method}${cleanPath}`;
        md.update(message, 'utf8');
        const pss = forge.pss.create({
            md: forge.md.sha256.create(),
            mgf: forge.mgf.mgf1.create(forge.md.sha256.create()),
            saltLength: 32
        });
        const signature = privateKey.sign(md, pss);
        return forge.util.encode64(signature);
    } catch (e) {
        console.error("Signing failed:", e);
        throw new Error("Failed to sign request. Check your private key.");
    }
};
