
import { calculateStrategy } from '../kalshi-dashboard/src/utils/core.js';

console.log("--- TIMER STRATEGY VERIFICATION ---");

const now = Date.now();
const oneHour = 3600 * 1000;

// Test Cases
const testCases = [
    { name: "Far Future (> 24h)", commenceTime: new Date(now + 48 * oneHour).toISOString() },
    { name: "Tomorrow (< 24h)", commenceTime: new Date(now + 20 * oneHour).toISOString() },
    { name: "Starting Soon (< 1h)", commenceTime: new Date(now + 0.5 * oneHour).toISOString() },
    { name: "Starting Now", commenceTime: new Date(now + 1000).toISOString() },
];

const marginPercent = 10;

testCases.forEach(tc => {
    const market = {
        isMatchFound: true,
        fairValue: 50, // 50 cents
        bestBid: 40,
        bestAsk: 60,
        volatility: 0, // Zero vol to isolate timer effect
        commenceTime: tc.commenceTime
    };

    const result = calculateStrategy(market, marginPercent);

    // Calculate expected Max Willing To Pay based on margin
    // MaxPay = FairValue * (1 - Margin)
    // If Margin is 10%, MaxPay = 50 * 0.9 = 45.

    const impliedMargin = 1 - (result.maxWillingToPay / market.fairValue);

    console.log(`\nScenario: ${tc.name}`);
    console.log(`  Commence Time: ${tc.commenceTime}`);
    console.log(`  Fair Value: ${market.fairValue}`);
    console.log(`  Max Willing To Pay: ${result.maxWillingToPay}`);
    console.log(`  Implied Margin: ${(impliedMargin * 100).toFixed(2)}%`);
    console.log(`  Base Margin: ${marginPercent}%`);
});
