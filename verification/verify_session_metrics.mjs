
import { calculateSessionMetrics as optimizedMetrics } from '../kalshi-dashboard/src/utils/core.js';

// Original implementation from src/utils/core.js (before optimization)
const originalMetrics = (positions, tradeHistory) => {
    const metrics = {
        totalTrades: 0,
        settledTrades: 0,
        pendingTrades: 0,
        cancelledOrders: 0,
        totalRealizedPnL: 0,
        totalUnrealizedPnL: 0,
        grossProfit: 0,
        grossLoss: 0,
        totalFees: 0,
        netPnL: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        winRate: 0,
        bestTrade: null,
        worstTrade: null,
        largestWin: 0,
        largestLoss: 0,
        totalEntryEdge: 0,
        avgEntryEdge: 0,
        totalExitEdge: 0,
        avgExitEdge: 0,
        edgeCaptureRate: 0,
        totalHoldTime: 0,
        avgHoldTime: 0,
        minHoldTime: Infinity,
        maxHoldTime: 0,
        maxExposure: 0,
        avgExposure: 0,
        currentExposure: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        volatility: 0,
        uniqueMarkets: 0,
        sportBreakdown: {},
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

    for (const p of positions) {
        const historyEntry = tradeHistory[p.marketId];

        if (!p.isOrder && historyEntry && historyEntry.source === 'auto') {
            metrics.totalTrades++;
            markets.add(p.marketId);

            const sport = historyEntry.event?.split(' ')[0] || 'Unknown';
            sports[sport] = (sports[sport] || 0) + 1;

            if (historyEntry.fairValue && p.avgPrice) {
                const entryEdge = historyEntry.fairValue - p.avgPrice;
                entryEdges.push(entryEdge);
                metrics.totalEntryEdge += entryEdge;
            }

            if (p.settlementStatus === 'settled' || p.realizedPnl !== undefined) {
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

                if (historyEntry.orderPlacedAt && p.settled) {
                    const holdTime = p.settled - historyEntry.orderPlacedAt;
                    holdTimes.push(holdTime);
                    metrics.totalHoldTime += holdTime;
                    metrics.minHoldTime = Math.min(metrics.minHoldTime, holdTime);
                    metrics.maxHoldTime = Math.max(metrics.maxHoldTime, holdTime);
                }

                if (p.payout && p.quantity) {
                    const exitPrice = Math.floor(p.payout / p.quantity);
                    const exitFV = historyEntry.fairValue;
                    if (exitFV) {
                        const exitEdge = exitPrice - exitFV;
                        exitEdges.push(exitEdge);
                        metrics.totalExitEdge += exitEdge;
                    }
                }

                if (p.fees) {
                    metrics.totalFees += p.fees;
                }

                settledPositions.push(p);
            } else {
                metrics.pendingTrades++;
                activePositions.push(p);

                if (p.cost) {
                    metrics.currentExposure += p.cost;
                }
            }
        }
    }

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

    if (metrics.settledTrades > 0) {
        metrics.winRate = (metrics.wins / metrics.settledTrades) * 100;
    }

    if (metrics.avgEntryEdge > 0) {
        const avgRealizedEdge = metrics.settledTrades > 0 ? (metrics.totalRealizedPnL / metrics.settledTrades) / 10 : 0;
        metrics.edgeCaptureRate = (avgRealizedEdge / metrics.avgEntryEdge) * 100;
    }

    metrics.netPnL = metrics.totalRealizedPnL - metrics.totalFees;

    if (pnlArray.length >= 2) {
        const mean = metrics.totalRealizedPnL / pnlArray.length;
        const variance = pnlArray.reduce((sum, pnl) => sum + Math.pow(pnl - mean, 2), 0) / (pnlArray.length - 1);
        const stdDev = Math.sqrt(variance);
        metrics.volatility = stdDev;

        if (stdDev > 0) {
            const tradesPerYear = 100;
            metrics.sharpeRatio = (mean / stdDev) * Math.sqrt(tradesPerYear);
        }
    }

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

    metrics.uniqueMarkets = markets.size;
    metrics.sportBreakdown = sports;

    const totalCost = settledPositions.reduce((sum, p) => sum + (p.cost || 0), 0);
    metrics.roi = totalCost > 0 ? (metrics.totalRealizedPnL / totalCost) * 100 : 0;

    return metrics;
};


// Test
const runTest = () => {
    // Generate mock positions
    const positions = [];
    const tradeHistory = {};

    for (let i = 0; i < 5000; i++) {
        const isOrder = Math.random() > 0.8; // 20% are orders, ignored
        const status = isOrder ? 'resting' : (Math.random() > 0.5 ? 'HELD' : 'filled');
        const settlementStatus = (!isOrder && Math.random() > 0.5) ? 'settled' : null;
        const realizedPnl = settlementStatus ? Math.floor(Math.random() * 200 - 100) : 0;
        const fees = Math.floor(Math.random() * 20);

        positions.push({
            marketId: `mkt-${i}`,
            isOrder,
            status,
            avgPrice: Math.floor(Math.random() * 99),
            quantity: 10,
            cost: 500,
            settlementStatus,
            realizedPnl,
            fees,
            payout: settlementStatus ? (realizedPnl + fees + 500) : 0, // Approx
            settled: Date.now() - Math.floor(Math.random() * 100000),
            side: 'Yes'
        });

        // 80% have history with auto source
        if (Math.random() > 0.2) {
            tradeHistory[`mkt-${i}`] = {
                source: 'auto',
                event: 'Sport Name',
                fairValue: Math.floor(Math.random() * 99),
                orderPlacedAt: Date.now() - Math.floor(Math.random() * 200000)
            };
        }
    }

    console.log(`Running benchmark with ${positions.length} positions...`);

    const start1 = performance.now();
    const res1 = originalMetrics(positions, tradeHistory);
    const end1 = performance.now();
    console.log(`Original: ${(end1 - start1).toFixed(3)}ms`);

    const start2 = performance.now();
    const res2 = optimizedMetrics(positions, tradeHistory);
    const end2 = performance.now();
    console.log(`Optimized: ${(end2 - start2).toFixed(3)}ms`);

    // Compare
    const keys = Object.keys(res1);
    let match = true;
    for (const key of keys) {
        const v1 = res1[key];
        const v2 = res2[key];

        if (key === 'sportBreakdown') {
             // Deep compare object
             if (JSON.stringify(v1) !== JSON.stringify(v2)) {
                 console.error(`Mismatch in ${key}:`, v1, v2);
                 match = false;
             }
        } else if (typeof v1 === 'number') {
            if (Math.abs(v1 - v2) > 0.0001) {
                console.error(`Mismatch in ${key}: Original=${v1}, Optimized=${v2}`);
                match = false;
            }
        } else if (v1 !== v2) {
             console.error(`Mismatch in ${key}: Original=${v1}, Optimized=${v2}`);
             match = false;
        }
    }

    if (match) console.log("✅ Results Match!");
    else {
        console.log("❌ Results Mismatch");
        process.exit(1);
    }
};

runTest();
