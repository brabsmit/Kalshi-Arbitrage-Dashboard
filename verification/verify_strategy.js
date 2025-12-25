// Verification script for calculateStrategy logic

// MOCK: Original Implementation
const calculateStrategyOriginal = (market, marginPercent) => {
    if (!market.isMatchFound) return { smartBid: null, reason: "No Market", edge: -100, maxWillingToPay: 0 };

    const fairValue = market.fairValue;

    const maxWillingToPay = Math.floor(fairValue * (1 - marginPercent / 100));
    const currentBestBid = market.bestBid || 0;
    const edge = fairValue - currentBestBid;

    let smartBid = currentBestBid + 1;
    let reason = "Beat Market";

    if (smartBid > maxWillingToPay) {
        smartBid = maxWillingToPay;
        reason = "Max Limit";
    }

    if (smartBid > 99) smartBid = 99;

    return { smartBid, maxWillingToPay, edge, reason };
};

// MOCK: Alpha Implementation
const calculateStrategyAlpha = (market, marginPercent) => {
    if (!market.isMatchFound) return { smartBid: null, reason: "No Market", edge: -100, maxWillingToPay: 0 };

    const fairValue = market.fairValue;
    const volatility = market.volatility || 0;

    // Alpha: Dynamic Volatility Padding
    // If vol is high, we demand more margin.
    // Volatility is in cents (Standard Deviation).
    // Logic: Add volatility directly to margin percentage.
    // If Margin=15%, Vol=2.0 -> Effective Margin = 17%

    const effectiveMargin = marginPercent + volatility;

    const maxWillingToPay = Math.floor(fairValue * (1 - effectiveMargin / 100));
    const currentBestBid = market.bestBid || 0;
    const edge = fairValue - currentBestBid;

    let smartBid = currentBestBid + 1;
    let reason = "Beat Market";

    if (smartBid > maxWillingToPay) {
        smartBid = maxWillingToPay;
        reason = "Max Limit"; // or "Vol Limit"
    }

    if (smartBid > 99) smartBid = 99;

    return { smartBid, maxWillingToPay, edge, reason, effectiveMargin };
};

// Test Data
const markets = [
    { id: 1, isMatchFound: true, fairValue: 50, bestBid: 40, volatility: 0, name: "Stable Market" },
    { id: 2, isMatchFound: true, fairValue: 50, bestBid: 40, volatility: 2.0, name: "Volatile Market" },
    { id: 3, isMatchFound: true, fairValue: 50, bestBid: 40, volatility: 5.0, name: "Crazy Market" },
];

const marginPercent = 15;

console.log("--- STRATEGY VERIFICATION ---");
console.log(`Base Margin: ${marginPercent}%`);

markets.forEach(m => {
    console.log(`\nMarket: ${m.name} (FV: ${m.fairValue}, Bid: ${m.bestBid}, Vol: ${m.volatility})`);

    const original = calculateStrategyOriginal(m, marginPercent);
    const alpha = calculateStrategyAlpha(m, marginPercent);

    console.log(`  [Original] MaxPay: ${original.maxWillingToPay} | SmartBid: ${original.smartBid}`);
    console.log(`  [Alpha   ] MaxPay: ${alpha.maxWillingToPay} | SmartBid: ${alpha.smartBid} | EffMargin: ${alpha.effectiveMargin}%`);

    const diff = original.maxWillingToPay - alpha.maxWillingToPay;
    if (diff > 0) {
        console.log(`  ✅ Alpha reduced MaxPay by ${diff} cents (Risk Reduction)`);
    } else {
        console.log(`  ℹ️ No change in risk profile`);
    }
});
