
const { calculateStrategy } = require('../kalshi-dashboard/src/utils/core.js');

// Mock market data generator
const createMarket = (hoursUntilStart, fairValue = 50, bestBid = 40) => {
    const commenceTime = new Date(Date.now() + hoursUntilStart * 60 * 60 * 1000).toISOString();
    return {
        isMatchFound: true,
        fairValue,
        bestBid,
        bestAsk: 60,
        commenceTime,
        ticker: 'TEST-24MAY22-G1',
        volatility: 1 // should be ignored by current logic
    };
};

const marginPercent = 20;

console.log("--- TIMER STRATEGY VERIFICATION ---");
console.log(`Base Margin: ${marginPercent}%`);

const scenarios = [
    { name: "Far Future (> 6h)", hours: 24, expectedMultiplier: 1.0 },
    { name: "Near Future (< 6h)", hours: 5, expectedMultiplier: 1.25 },
    { name: "Immediate (< 1h)", hours: 0.5, expectedMultiplier: 1.5 },
];

let failed = false;

scenarios.forEach(scenario => {
    const market = createMarket(scenario.hours);
    const result = calculateStrategy(market, marginPercent);

    // Reverse engineer the effective margin from maxWillingToPay
    // maxWillingToPay = floor(fairValue * (1 - effectiveMargin / 100))
    // effectiveMargin = 100 * (1 - maxWillingToPay / fairValue)

    // Note: Due to floor(), this might be slightly off, so we should check bounds or strict equality if we can access effectiveMargin directly.
    // Ideally calculateStrategy should return effectiveMargin or we infer it.
    // But since we are modifying calculateStrategy, we can make it return effectiveMargin or just verify the outcome (maxWillingToPay).

    const expectedMargin = marginPercent * scenario.expectedMultiplier;
    const expectedMaxPay = Math.floor(market.fairValue * (1 - expectedMargin / 100));

    console.log(`\nScenario: ${scenario.name} (${scenario.hours}h)`);
    console.log(`  Target Multiplier: ${scenario.expectedMultiplier}x -> Expected Margin: ${expectedMargin}%`);
    console.log(`  Expected MaxPay: ${expectedMaxPay}`);
    console.log(`  Actual MaxPay:   ${result.maxWillingToPay}`);

    if (result.maxWillingToPay === expectedMaxPay) {
        console.log("  ✅ PASS");
    } else {
        console.log("  ❌ FAIL");
        console.log(`     Difference: ${result.maxWillingToPay - expectedMaxPay}`);
        failed = true;
    }
});

if (failed) {
    console.log("\n❌ Verification Failed: Strategy does not implement Time Decay correctly.");
    process.exit(1);
} else {
    console.log("\n✅ Verification Passed: Time Decay logic is active.");
}
