
import { calculateStrategy } from '../src/utils/core.js';

console.log("Verifying The Timer strategy logic...");

// Mock market data
const baseMarket = {
    isMatchFound: true,
    fairValue: 50,
    volatility: 0,
    bestBid: 40,
    bestAsk: 60,
    // Future time: 2 hours from now
    commenceTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
};

const marginPercent = 10;

// Case 1: > 1 hour until start (No Penalty)
const result1 = calculateStrategy(baseMarket, marginPercent);
console.log(`\nCase 1: > 1 hour until start`);
console.log(`MaxWillingToPay: ${result1.maxWillingToPay}`);
// Expected: 50 * (1 - 0.10) = 45

if (result1.maxWillingToPay !== 45) {
    console.error(`FAIL: Expected 45, got ${result1.maxWillingToPay}`);
} else {
    console.log("PASS");
}

// Case 2: 30 minutes until start (0.5 hours)
// Penalty should be 5 * (1 - 0.5) = 2.5%
// Effective Margin = 10 + 2.5 = 12.5%
const marketSoon = {
    ...baseMarket,
    commenceTime: new Date(Date.now() + 30 * 60 * 1000).toISOString()
};

const result2 = calculateStrategy(marketSoon, marginPercent);
console.log(`\nCase 2: 30 minutes until start`);
console.log(`MaxWillingToPay: ${result2.maxWillingToPay}`);
// Expected: 50 * (1 - 0.125) = 50 * 0.875 = 43.75 -> floor(43.75) = 43

if (result2.maxWillingToPay !== 43) {
    console.error(`FAIL: Expected 43, got ${result2.maxWillingToPay}`);
} else {
    console.log("PASS");
}

// Case 3: 5 minutes until start (5/60 = 0.0833 hours)
// Penalty should be 5 * (1 - 0.0833) = 5 * 0.9167 = 4.58%
// Effective Margin = 10 + 4.58 = 14.58%
const marketVerySoon = {
    ...baseMarket,
    commenceTime: new Date(Date.now() + 5 * 60 * 1000).toISOString()
};

const result3 = calculateStrategy(marketVerySoon, marginPercent);
console.log(`\nCase 3: 5 minutes until start`);
console.log(`MaxWillingToPay: ${result3.maxWillingToPay}`);
// Expected: 50 * (1 - 0.1458) = 50 * 0.8542 = 42.71 -> floor(42.71) = 42

if (result3.maxWillingToPay !== 42) {
    console.error(`FAIL: Expected 42, got ${result3.maxWillingToPay}`);
} else {
    console.log("PASS");
}

// Case 4: Game Started (Past commence time)
// Penalty should be 5% (Max)
// Effective Margin = 10 + 5 = 15%
const marketStarted = {
    ...baseMarket,
    commenceTime: new Date(Date.now() - 5 * 60 * 1000).toISOString()
};

const result4 = calculateStrategy(marketStarted, marginPercent);
console.log(`\nCase 4: Game Started (-5 mins)`);
console.log(`MaxWillingToPay: ${result4.maxWillingToPay}`);
// Expected: 50 * (1 - 0.15) = 50 * 0.85 = 42.5 -> floor(42.5) = 42

if (result4.maxWillingToPay !== 42) {
    console.error(`FAIL: Expected 42, got ${result4.maxWillingToPay}`);
} else {
    console.log("PASS");
}
