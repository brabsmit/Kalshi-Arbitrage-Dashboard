
const calculateVolatility = (history) => {
    if (!history || history.length < 2) return 0;
    let sum = 0;
    let sumSq = 0;
    const n = history.length;
    // Single pass O(N) loop
    for (let i = 0; i < n; i++) {
        const v = history[i].v;
        sum += v;
        sumSq += v * v;
    }
    // Variance = (SumSq - (Sum*Sum)/N) / (N - 1)
    const variance = (sumSq - (sum * sum) / n) / (n - 1);
    return Math.sqrt(Math.max(0, variance));
};

const calculateStrategy = (market, marginPercent) => {
    if (!market.isMatchFound) return { smartBid: null, reason: "No Market", edge: -100, maxWillingToPay: 0 };

    const fairValue = market.fairValue;
    const volatility = market.volatility || 0;

    // ALPHA STRATEGY: Volatility Adjusted Margin
    const effectiveMargin = marginPercent + volatility;

    const maxWillingToPay = Math.floor(fairValue * (1 - effectiveMargin / 100));
    const currentBestBid = market.bestBid || 0;
    const edge = fairValue - currentBestBid;

    let smartBid = currentBestBid + 1;
    let reason = "Beat Market";

    if (smartBid > maxWillingToPay) {
        smartBid = maxWillingToPay;
        reason = "Max Limit";
    }

    if (smartBid > 99) smartBid = 99;

    return { smartBid, maxWillingToPay, edge, reason, effectiveMargin };
};

// Test Case 1: Stable Market
const stableHistory = Array(10).fill({ v: 50 }); // Price always 50
const volStable = calculateVolatility(stableHistory);
console.log(`Stable Volatility: ${volStable}`); // Should be 0

const marketStable = {
    isMatchFound: true,
    fairValue: 50,
    volatility: volStable,
    bestBid: 40
};

const stratStable = calculateStrategy(marketStable, 10);
console.log("Stable Strategy:", stratStable);
// Expected: Margin 10%. MaxPay = 50 * 0.9 = 45. Bid 41.

// Test Case 2: Volatile Market (40-60 oscillation)
const volatileHistory = [
    { v: 40 }, { v: 60 }, { v: 40 }, { v: 60 },
    { v: 40 }, { v: 60 }, { v: 40 }, { v: 60 }
];
const volHigh = calculateVolatility(volatileHistory);
console.log(`High Volatility: ${volHigh}`); // Approx 10?

const marketVolatile = {
    isMatchFound: true,
    fairValue: 50, // Mean is 50
    volatility: volHigh,
    bestBid: 40
};

const stratVolatile = calculateStrategy(marketVolatile, 10);
console.log("Volatile Strategy:", stratVolatile);
// Expected: Margin 10 + ~10 = ~20%. MaxPay = 50 * 0.8 = 40. Bid 40 (capped).
