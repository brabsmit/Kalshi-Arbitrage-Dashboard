
// Verification script for "The Timer" strategy logic

// Mock market object
const createMarket = (minutesUntilStart, fairValue = 50, volatility = 0) => {
    const now = Date.now();
    const commenceTime = new Date(now + minutesUntilStart * 60 * 1000).toISOString();
    return {
        isMatchFound: true,
        fairValue,
        volatility,
        bestBid: 40,
        bestAsk: 60,
        commenceTime
    };
};

const calculateStrategy = (market, marginPercent) => {
    if (!market.isMatchFound) return { smartBid: null, reason: "No Market", edge: -100, maxWillingToPay: 0 };

    const fairValue = market.fairValue;

    // Alpha Strategy: Dynamic Volatility Padding
    const volatility = market.volatility || 0;
    let effectiveMargin = marginPercent + (volatility * 0.25);

    // =================================================================
    // NEW LOGIC: The Timer
    // =================================================================
    const now = Date.now();
    const commence = new Date(market.commenceTime).getTime();
    const diffMins = (commence - now) / 60000;

    let timePenalty = 0;
    if (diffMins <= 0) {
        // Game started: Max Penalty
        timePenalty = 5;
    } else if (diffMins < 60) {
        // Last hour: Linear scale 0 -> 5
        // at 60 mins: 0
        // at 30 mins: 2.5
        // at 0 mins: 5
        timePenalty = 5 * ((60 - diffMins) / 60);
    }

    effectiveMargin += timePenalty;
    // =================================================================

    const maxWillingToPay = Math.floor(fairValue * (1 - effectiveMargin / 100));

    return { maxWillingToPay, effectiveMargin, timePenalty, diffMins };
};

// Tests
const runTest = (name, minutes, margin, expectedPenalty) => {
    const market = createMarket(minutes);
    const result = calculateStrategy(market, margin);
    const penalty = result.timePenalty;
    const isPass = Math.abs(penalty - expectedPenalty) < 0.1;
    console.log(`${isPass ? 'PASS' : 'FAIL'} [${name}] Time: ${minutes}m | Penalty: ${penalty.toFixed(2)}% | Expected: ${expectedPenalty}%`);
    if (!isPass) console.log("   Result:", result);
};

console.log("--- Verifying 'The Timer' Strategy ---");
runTest("2 Hours Out", 120, 10, 0);
runTest("1 Hour Out", 60, 10, 0);
runTest("30 Mins Out", 30, 10, 2.5);
runTest("10 Mins Out", 10, 10, 5 * (50/60)); // ~4.16
runTest("Start Time", 0, 10, 5);
runTest("Started 10m ago", -10, 10, 5);
