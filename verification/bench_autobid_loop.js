const { performance } = require('perf_hooks');

// Setup Data
const MARKET_COUNT = 500;
const POSITION_COUNT = 5000;

const markets = Array.from({ length: MARKET_COUNT }, (_, i) => ({
    id: `m-${i}`,
    realMarketId: `TICKER-${i}`
}));

const positions = Array.from({ length: POSITION_COUNT }, (_, i) => {
    const isOrder = Math.random() > 0.5;
    const marketId = `TICKER-${Math.floor(Math.random() * MARKET_COUNT * 1.5)}`; // Some outside range
    return {
        id: `p-${i}`,
        marketId,
        isOrder,
        quantity: Math.floor(Math.random() * 100),
        status: isOrder ? (Math.random() > 0.2 ? 'active' : 'cancelled') : 'HELD',
        settlementStatus: !isOrder ? (Math.random() > 0.8 ? 'settled' : 'unsettled') : null
    };
});

console.log(`Setup: ${MARKET_COUNT} markets, ${POSITION_COUNT} positions.`);

function runOriginal() {
    const currentMarketIds = new Set(markets.map(m => m.realMarketId));

    const executedHoldings = new Set(positions.filter(p =>
        !p.isOrder &&
        p.quantity > 0 &&
        p.settlementStatus !== 'settled' &&
        currentMarketIds.has(p.marketId)
    ).map(p => p.marketId));

    const activeOrders = positions.filter(p =>
        p.isOrder &&
        ['active', 'resting', 'bidding', 'pending'].includes(p.status.toLowerCase()) &&
        currentMarketIds.has(p.marketId)
    );

    const marketsWithOrders = new Set(activeOrders.map(o => o.marketId));
    const occupiedMarkets = new Set([...executedHoldings, ...marketsWithOrders]);

    return { executedHoldings, activeOrders, occupiedMarkets };
}

function runOptimized() {
    const currentMarketIds = new Set(markets.map(m => m.realMarketId));
    const executedHoldings = new Set();
    const activeOrders = [];
    const occupiedMarkets = new Set();

    for (const p of positions) {
        if (!currentMarketIds.has(p.marketId)) continue;

        if (p.isOrder) {
            if (['active', 'resting', 'bidding', 'pending'].includes(p.status.toLowerCase())) {
                activeOrders.push(p);
                occupiedMarkets.add(p.marketId);
            }
        } else if (p.quantity > 0 && p.settlementStatus !== 'settled') {
            executedHoldings.add(p.marketId);
            occupiedMarkets.add(p.marketId);
        }
    }

    return { executedHoldings, activeOrders, occupiedMarkets };
}

// Warmup
for (let i = 0; i < 100; i++) {
    runOriginal();
    runOptimized();
}

// Verify Correctness
const resA = runOriginal();
const resB = runOptimized();

if (resA.executedHoldings.size !== resB.executedHoldings.size) console.error("Mismatch executedHoldings size");
if (resA.activeOrders.length !== resB.activeOrders.length) console.error("Mismatch activeOrders length");
if (resA.occupiedMarkets.size !== resB.occupiedMarkets.size) console.error("Mismatch occupiedMarkets size");

// Benchmark
const ITERATIONS = 2000;

const startA = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    runOriginal();
}
const endA = performance.now();

const startB = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    runOptimized();
}
const endB = performance.now();

console.log(`Original: ${(endA - startA).toFixed(2)}ms`);
console.log(`Optimized: ${(endB - startB).toFixed(2)}ms`);
console.log(`Speedup: x${((endA - startA) / (endB - startB)).toFixed(2)}`);
