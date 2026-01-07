// Verification script for "The Timer" (Time Decay) strategy logic

// MOCK: Original Implementation (from src/utils/core.js)
const calculateStrategyOriginal = (market, marginPercent) => {
    if (!market.isMatchFound) return { smartBid: null, reason: "No Market", edge: -100, maxWillingToPay: 0 };

    const fairValue = market.fairValue;
    const volatility = market.volatility || 0;

    // Existing Alpha Strategy: Dynamic Volatility Padding
    const effectiveMargin = marginPercent + (volatility * 0.25);

    const maxWillingToPay = Math.floor(fairValue * (1 - effectiveMargin / 100));
    const currentBestBid = market.bestBid || 0;
    const edge = fairValue - currentBestBid;

    let smartBid = currentBestBid + 1;
    let reason = "Beat Market";

    // Crossing the Spread logic (simplified for this test)
    const TAKER_FEE_BUFFER = 0;
    if (market.bestAsk > 0 && market.bestAsk <= (maxWillingToPay - TAKER_FEE_BUFFER)) {
        smartBid = market.bestAsk;
        reason = "Take Ask";
    }

    if (smartBid > maxWillingToPay) {
        smartBid = maxWillingToPay;
        reason = "Max Limit";
    }

    if (smartBid > 99) smartBid = 99;

    return { smartBid, maxWillingToPay, effectiveMargin };
};

// MOCK: New Alpha Implementation with "The Timer"
const calculateStrategyAlpha = (market, marginPercent) => {
    if (!market.isMatchFound) return { smartBid: null, reason: "No Market", edge: -100, maxWillingToPay: 0 };

    const fairValue = market.fairValue;
    const volatility = market.volatility || 0;

    // Alpha Strategy: Dynamic Volatility Padding
    let effectiveMargin = marginPercent + (volatility * 0.25);

    // Alpha Strategy: The Timer (Time Decay)
    // As the event approaches, uncertainty increases (injuries, last minute news).
    // We increase the margin requirement linearly in the final hour.
    if (market.commenceTime) {
        const now = Date.now(); // Use real time or mocked time
        const start = new Date(market.commenceTime).getTime();
        const hoursRemaining = (start - now) / (1000 * 60 * 60);

        if (hoursRemaining < 1) {
            // MAX_TIME_PENALTY is 5% at T=0
            const MAX_TIME_PENALTY = 5.0;
            // Penalty scales from 0% at 1h to 5% at 0h
            // If hoursRemaining is negative (game started), we cap at max penalty or let it ride?
            // Usually we shouldn't bid on started games unless we have specific logic, but let's cap penalty at max.
            const timePenalty = hoursRemaining < 0 ? MAX_TIME_PENALTY : MAX_TIME_PENALTY * (1 - hoursRemaining);
            effectiveMargin += timePenalty;
        }
    }

    const maxWillingToPay = Math.floor(fairValue * (1 - effectiveMargin / 100));
    const currentBestBid = market.bestBid || 0;
    const edge = fairValue - currentBestBid;

    let smartBid = currentBestBid + 1;
    let reason = "Beat Market";

    // Crossing the Spread logic
    const TAKER_FEE_BUFFER = 0;
    if (market.bestAsk > 0 && market.bestAsk <= (maxWillingToPay - TAKER_FEE_BUFFER)) {
        smartBid = market.bestAsk;
        reason = "Take Ask";
    }

    if (smartBid > maxWillingToPay) {
        smartBid = maxWillingToPay;
        reason = "Max Limit";
    }

    if (smartBid > 99) smartBid = 99;

    return { smartBid, maxWillingToPay, effectiveMargin };
};

// --- RUN TESTS ---

const now = Date.now();
const oneMinute = 60 * 1000;
const oneHour = 60 * oneMinute;

const scenarios = [
    { name: "Game in 2 Hours", offset: 2 * oneHour },
    { name: "Game in 45 Mins", offset: 45 * oneMinute },
    { name: "Game in 15 Mins", offset: 15 * oneMinute },
    { name: "Game in 1 Min", offset: 1 * oneMinute },
    { name: "Game Just Started (-1m)", offset: -1 * oneMinute },
];

const baseMarket = {
    isMatchFound: true,
    fairValue: 50, // 50 cents
    bestBid: 40,
    bestAsk: 60,
    volatility: 0 // Keep vol 0 to isolate time effect
};

const marginPercent = 10; // Base margin 10% -> MaxPay should be 45c (50 * 0.9)

console.log("--- THE TIMER STRATEGY VERIFICATION ---");
console.log(`Base Margin: ${marginPercent}%`);
console.log(`Base FV: ${baseMarket.fairValue}¢`);

scenarios.forEach(s => {
    const commenceTime = new Date(now + s.offset).toISOString();
    const market = { ...baseMarket, commenceTime };

    console.log(`\nScenario: ${s.name} (Offset: ${s.offset / 60000}m)`);

    const original = calculateStrategyOriginal(market, marginPercent);
    const alpha = calculateStrategyAlpha(market, marginPercent);

    console.log(`  [Original] EffMargin: ${original.effectiveMargin.toFixed(2)}% | MaxPay: ${original.maxWillingToPay}¢`);
    console.log(`  [Alpha   ] EffMargin: ${alpha.effectiveMargin.toFixed(2)}% | MaxPay: ${alpha.maxWillingToPay}¢`);

    const marginDiff = alpha.effectiveMargin - original.effectiveMargin;
    if (marginDiff > 0) {
        console.log(`  ✅ Added Time Penalty: +${marginDiff.toFixed(2)}% margin`);
    } else {
        console.log(`  ℹ️ No Time Penalty`);
    }
});
