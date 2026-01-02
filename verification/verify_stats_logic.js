
// Mock helper functions
const calculateTStatistic = (pnls) => {
    if (!pnls || pnls.length < 5) return { tStat: 0, isSignificant: false };

    const n = pnls.length;
    const mean = pnls.reduce((a, b) => a + b, 0) / n;
    const variance = pnls.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);
    const stdDev = Math.sqrt(variance);

    let tStat = 0;
    if (stdDev > 0) {
        const stdError = stdDev / Math.sqrt(n);
        tStat = mean / stdError;
    }

    const isSignificant = Math.abs(tStat) > 2.0;
    return { tStat, isSignificant };
};

// Original Logic
const originalStats = (positions, tradeHistory) => {
    const exposure = positions.reduce((acc, p) => {
        if (p.isOrder && ['active', 'resting', 'bidding', 'pending'].includes(p.status?.toLowerCase())) {
            return acc + (p.price * (p.quantity - p.filled));
        }
        if (!p.isOrder && p.status === 'HELD') {
            return acc + p.cost;
        }
        return acc;
    }, 0);

    const historyItems = positions.filter(p => !p.isOrder && (p.settlementStatus === 'settled' || p.realizedPnl));
    const totalRealizedPnl = historyItems.reduce((acc, p) => acc + (p.realizedPnl || 0), 0);

    const heldPositions = positions.filter(p => !p.isOrder && p.status === 'HELD');
    const totalPotentialReturn = heldPositions.reduce((acc, p) => acc + ((p.quantity * 100) - p.cost), 0);

    // WIN RATE: Calculated only on AUTO-BID positions
    const autoBidHistory = historyItems.filter(p => tradeHistory && tradeHistory[p.marketId] && tradeHistory[p.marketId].source === 'auto');
    const winCount = autoBidHistory.filter(p => (p.realizedPnl || 0) > 0).length;
    const totalSettled = autoBidHistory.length;
    const winRate = totalSettled > 0 ? Math.round((winCount / totalSettled) * 100) : 0;

    // --- T-STATISTIC CALCULATION ---
    const pnls = autoBidHistory.map(p => p.realizedPnl || 0);
    const { tStat, isSignificant } = calculateTStatistic(pnls);
    // -------------------------------

    return { exposure, totalRealizedPnl, totalPotentialReturn, winRate, tStat, isSignificant, historyCount: historyItems.length };
};

// Optimized Logic
const optimizedStats = (positions, tradeHistory) => {
    let exposure = 0;
    let totalRealizedPnl = 0;
    let totalPotentialReturn = 0;
    let historyCount = 0;

    let autoBidCount = 0;
    let autoBidWins = 0;

    // For T-Stat (Welford's or standard 2-pass inline? No, let's just collect sums for standard variance)
    // Variance = (SumSq - (Sum*Sum)/N) / (N-1)
    // This is mathematically equivalent to the helper's implementation but single pass.
    let sumPnl = 0;
    let sumSqPnl = 0;

    for (const p of positions) {
        // Exposure
        if (p.isOrder && ['active', 'resting', 'bidding', 'pending'].includes(p.status?.toLowerCase())) {
            exposure += (p.price * (p.quantity - p.filled));
        } else if (!p.isOrder && p.status === 'HELD') {
            exposure += p.cost;
            // Potential Return
            totalPotentialReturn += ((p.quantity * 100) - p.cost);
        }

        // History / Realized
        if (!p.isOrder && (p.settlementStatus === 'settled' || p.realizedPnl)) {
            const rPnl = p.realizedPnl || 0;
            totalRealizedPnl += rPnl;
            historyCount++;

            // Auto-Bid Stats
            if (tradeHistory && tradeHistory[p.marketId] && tradeHistory[p.marketId].source === 'auto') {
                autoBidCount++;
                if (rPnl > 0) autoBidWins++;

                sumPnl += rPnl;
                sumSqPnl += rPnl * rPnl;
            }
        }
    }

    const winRate = autoBidCount > 0 ? Math.round((autoBidWins / autoBidCount) * 100) : 0;

    let tStat = 0;
    let isSignificant = false;

    if (autoBidCount >= 5) {
         const mean = sumPnl / autoBidCount;
         // Note: helper uses pow(b - mean, 2).
         // Variance formula E[X^2] - (E[X])^2 is prone to precision issues for large numbers, but PnL is usually small integers/floats.
         // Let's verify precision.

         const variance = (sumSqPnl - (sumPnl * sumPnl) / autoBidCount) / (autoBidCount - 1);
         // Safety check for negative variance due to floating point error
         const stdDev = Math.sqrt(Math.max(0, variance));

         if (stdDev > 0) {
             const stdError = stdDev / Math.sqrt(autoBidCount);
             tStat = mean / stdError;
             isSignificant = Math.abs(tStat) > 2.0;
         }
    }

    return { exposure, totalRealizedPnl, totalPotentialReturn, winRate, tStat, isSignificant, historyCount };
};

// Test
const runTest = () => {
    // Generate mock positions
    const positions = [];
    const tradeHistory = {};
    const STATUSES = ['active', 'resting', 'HELD', 'filled', 'canceled'];

    for (let i = 0; i < 1000; i++) {
        const isOrder = Math.random() > 0.5;
        const status = isOrder ? 'resting' : (Math.random() > 0.5 ? 'HELD' : 'filled');
        const settlementStatus = (!isOrder && Math.random() > 0.5) ? 'settled' : null;
        const realizedPnl = settlementStatus ? Math.floor(Math.random() * 200 - 100) : 0;

        positions.push({
            marketId: `mkt-${i}`,
            isOrder,
            status,
            price: Math.floor(Math.random() * 99),
            quantity: 10,
            filled: isOrder ? 2 : 0,
            cost: 500,
            settlementStatus,
            realizedPnl,
            side: 'Yes'
        });

        if (Math.random() > 0.3) {
            tradeHistory[`mkt-${i}`] = { source: 'auto' };
        }
    }

    console.time("Original");
    const res1 = originalStats(positions, tradeHistory);
    console.timeEnd("Original");

    console.time("Optimized");
    const res2 = optimizedStats(positions, tradeHistory);
    console.timeEnd("Optimized");

    // Compare
    const keys = Object.keys(res1);
    let match = true;
    for (const key of keys) {
        // Use epsilon for float comparison if needed, but T-Stat logic differs slightly (helper vs inline variance formula)
        // Helper: sum((x-mean)^2)
        // Inline: sum(x^2) - (sum(x)^2)/n
        // These are algebraically equivalent but floating point might differ slightly.
        const v1 = res1[key];
        const v2 = res2[key];

        if (typeof v1 === 'number') {
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
    else console.log("❌ Results Mismatch");
};

runTest();
