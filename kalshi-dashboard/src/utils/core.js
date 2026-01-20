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

// ==========================================
// PORTFOLIO CALCULATIONS
// ==========================================

export const calculateUnrealizedPnL = (quantity, entryPrice, currentPrice) => {
    // Returns P&L in cents
    return quantity * (currentPrice - entryPrice);
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

    const settledPositions = [];
    const activePositions = [];
    const pnlArray = [];
    const holdTimes = [];
    const entryEdges = [];
    const exitEdges = [];
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
                entryEdges.push(entryEdge);
                metrics.totalEntryEdge += entryEdge;
            }

            if (p.settlementStatus === 'settled' || p.realizedPnl !== undefined) {
                // Settled trade
                metrics.settledTrades++;
                const pnl = p.realizedPnl || 0;
                pnlArray.push(pnl);
                metrics.totalRealizedPnL += pnl;

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
                    holdTimes.push(holdTime);
                    metrics.totalHoldTime += holdTime;
                    metrics.minHoldTime = Math.min(metrics.minHoldTime, holdTime);
                    metrics.maxHoldTime = Math.max(metrics.maxHoldTime, holdTime);
                }

                // Exit edge (if we have exit price)
                if (p.payout && p.quantity) {
                    const exitPrice = Math.floor(p.payout / p.quantity);
                    const exitFV = historyEntry.fairValue; // Approximate, should track actual FV at exit
                    if (exitFV) {
                        const exitEdge = exitPrice - exitFV;
                        exitEdges.push(exitEdge);
                        metrics.totalExitEdge += exitEdge;
                    }
                }

                // Fees
                if (p.fees) {
                    metrics.totalFees += p.fees;
                }

                settledPositions.push(p);
            } else {
                // Active/pending trade
                metrics.pendingTrades++;
                activePositions.push(p);

                // Current exposure
                if (p.cost) {
                    metrics.currentExposure += p.cost;
                }
            }
        }
    }

    // Calculate averages
    if (metrics.totalTrades > 0) {
        metrics.avgEntryEdge = metrics.totalEntryEdge / entryEdges.length || 0;
    }

    if (exitEdges.length > 0) {
        metrics.avgExitEdge = metrics.totalExitEdge / exitEdges.length;
    }

    if (holdTimes.length > 0) {
        metrics.avgHoldTime = metrics.totalHoldTime / holdTimes.length;
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
    if (pnlArray.length >= 2) {
        const mean = metrics.totalRealizedPnL / pnlArray.length;
        const variance = pnlArray.reduce((sum, pnl) => sum + Math.pow(pnl - mean, 2), 0) / (pnlArray.length - 1);
        const stdDev = Math.sqrt(variance);
        metrics.volatility = stdDev;

        if (stdDev > 0) {
            // Sharpe = (mean return) / (std dev of returns)
            // Annualize assuming ~100 trades per year for sports betting
            const tradesPerYear = 100;
            metrics.sharpeRatio = (mean / stdDev) * Math.sqrt(tradesPerYear);
        }
    }

    // Max drawdown (simplified - track worst cumulative loss)
    let cumulativePnL = 0;
    let peak = 0;
    let maxDD = 0;

    for (const pnl of pnlArray) {
        cumulativePnL += pnl;
        if (cumulativePnL > peak) {
            peak = cumulativePnL;
        }
        const drawdown = peak - cumulativePnL;
        if (drawdown > maxDD) {
            maxDD = drawdown;
        }
    }
    metrics.maxDrawdown = maxDD;

    // Unique markets and sports
    metrics.uniqueMarkets = markets.size;
    metrics.sportBreakdown = sports;

    // ROI
    const totalCost = settledPositions.reduce((sum, p) => sum + (p.cost || 0), 0);
    metrics.roi = totalCost > 0 ? (metrics.totalRealizedPnL / totalCost) * 100 : 0;

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
