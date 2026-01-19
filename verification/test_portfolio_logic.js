
const assert = require('assert');

function calculatePortfolioValue(balance, positions, markets) {
    if (balance === null) return null;

    // 1. Locked in Orders
    let lockedInOrders = 0;
    positions.forEach(p => {
        // Check if it's an active order
        if (p.isOrder && ['active', 'resting', 'bidding', 'pending'].includes(p.status?.toLowerCase())) {
            // Only BUY orders lock cash
            if (p.action === 'buy') {
                // Locked amount = Price * Remaining Quantity
                lockedInOrders += (p.price * (p.quantity - p.filled));
            }
        }
    });

    // 2. Position Market Value
    // Create price map for O(1) lookup
    const priceMap = new Map();
    markets.forEach(m => {
        if (m.realMarketId) priceMap.set(m.realMarketId, m.bestBid);
    });

    let positionsValue = 0;
    positions.forEach(p => {
        // Check if it's a held position (not an order) and not settled
        if (!p.isOrder && p.status === 'HELD' && (!p.settlementStatus || p.settlementStatus === 'unsettled')) {
            const marketPrice = priceMap.get(p.marketId);

            // Use market price if available, otherwise fallback to cost basis (avgPrice)
            // If avgPrice is missing, use cost / quantity if valid, else 0
            let valuationPrice = 0;
            if (marketPrice !== undefined) {
                valuationPrice = marketPrice;
            } else {
                valuationPrice = p.avgPrice || (p.quantity ? p.cost / p.quantity : 0) || 0;
            }

            positionsValue += p.quantity * valuationPrice;
        }
    });

    const totalValue = balance + lockedInOrders + positionsValue;
    return {
        balance,
        lockedInOrders,
        positionsValue,
        totalPortfolio: totalValue
    };
}

// --- MOCK DATA ---

const mockMarkets = [
    { realMarketId: 'NFL-GAME-1', bestBid: 50 }, // Market is live, Bid 50c
    { realMarketId: 'NBA-GAME-1', bestBid: 0 }   // Market live but no bid? Or 0.
];

const mockPositions = [
    // 1. Buy Order: Locks cash. 10 qty @ 20c. 0 filled. Locked: 200c.
    { isOrder: true, status: 'active', action: 'buy', price: 20, quantity: 10, filled: 0, marketId: 'NFL-GAME-2' },

    // 2. Sell Order: Does NOT lock cash. 5 qty @ 80c.
    { isOrder: true, status: 'resting', action: 'sell', price: 80, quantity: 5, filled: 0, marketId: 'NFL-GAME-1' },

    // 3. Held Position (Tracked Market): 10 qty. Market Bid 50c. Value: 500c.
    { isOrder: false, status: 'HELD', settlementStatus: 'unsettled', quantity: 10, avgPrice: 40, cost: 400, marketId: 'NFL-GAME-1' },

    // 4. Held Position (Untracked Market): 10 qty. No market data. AvgPrice 30c. Value: 300c (Fallback).
    { isOrder: false, status: 'HELD', settlementStatus: 'unsettled', quantity: 10, avgPrice: 30, cost: 300, marketId: 'MLB-GAME-1' },

    // 5. Settled Position: Should be ignored (cash in balance).
    { isOrder: false, status: 'HELD', settlementStatus: 'settled', quantity: 10, payout: 1000, marketId: 'NHL-GAME-1' },

    // 6. Buy Order Partial Fill: 10 qty @ 10c. 5 filled. Locked: 5 * 10 = 50c.
    { isOrder: true, status: 'active', action: 'buy', price: 10, quantity: 10, filled: 5, marketId: 'NFL-GAME-3' }
];

const mockBalance = 1000; // Cash available

// --- TEST EXECUTION ---

const result = calculatePortfolioValue(mockBalance, mockPositions, mockMarkets);

console.log("Calculated:", result);

// EXPECTED:
// Balance: 1000
// Locked:
//  - Buy Order 1: 10 * 20 = 200
//  - Sell Order: 0
//  - Buy Order 3: 5 * 10 = 50
//  Total Locked: 250

// Positions:
//  - NFL-GAME-1: 10 * 50 (Bid) = 500
//  - MLB-GAME-1: 10 * 30 (Avg) = 300
//  - Settled: 0
//  Total Positions: 800

// Total Portfolio: 1000 + 250 + 800 = 2050

const expectedTotal = 2050;

if (result.totalPortfolio === expectedTotal) {
    console.log("✅ TEST PASSED");
} else {
    console.error(`❌ TEST FAILED. Expected ${expectedTotal}, got ${result.totalPortfolio}`);
    process.exit(1);
}
