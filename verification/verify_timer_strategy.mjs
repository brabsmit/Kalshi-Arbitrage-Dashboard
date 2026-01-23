
import { calculateStrategy } from '../kalshi-dashboard/src/utils/core.js';

const marginPercent = 10;
const fairValue = 50;

const testCases = [
    {
        name: 'Long Term (> 6h)',
        offsetHours: 10,
        expectedMarginMultiplier: 1.0,
        expectedMaxWilling: 45 // 50 * (1 - 0.10) = 45
    },
    {
        name: 'Medium Term (< 6h)',
        offsetHours: 3,
        expectedMarginMultiplier: 1.25,
        expectedMaxWilling: 43 // 50 * (1 - 0.125) = 43.75 -> 43
    },
    {
        name: 'Short Term (< 1h)',
        offsetHours: 0.5,
        expectedMarginMultiplier: 1.5,
        expectedMaxWilling: 42 // 50 * (1 - 0.15) = 42.5 -> 42
    }
];

console.log('--- Verifying Timer Strategy ---');

let passed = true;

testCases.forEach(tc => {
    const commenceTime = new Date(Date.now() + tc.offsetHours * 60 * 60 * 1000).toISOString();
    const market = {
        isMatchFound: true,
        fairValue: fairValue,
        bestBid: 0,
        bestAsk: 0,
        commenceTime: commenceTime,
        volatility: 0
    };

    const result = calculateStrategy(market, marginPercent);

    // Note: effectiveMargin is not returned by calculateStrategy, so we infer it from maxWillingToPay
    // or we check maxWillingToPay directly against expected.

    console.log(`[${tc.name}] Offset: ${tc.offsetHours}h`);
    console.log(`  Expected Max Willing: ${tc.expectedMaxWilling}`);
    console.log(`  Actual Max Willing:   ${result.maxWillingToPay}`);

    if (result.maxWillingToPay !== tc.expectedMaxWilling) {
        console.error(`  ❌ FAILED: Expected ${tc.expectedMaxWilling}, got ${result.maxWillingToPay}`);
        passed = false;
    } else {
        console.log(`  ✅ PASSED`);
    }
    console.log('');
});

if (!passed) {
    console.log('One or more tests failed (Expected, as strategy is not implemented yet).');
} else {
    console.log('All tests passed.');
}
