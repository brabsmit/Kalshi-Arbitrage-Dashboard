
import { calculateStrategy } from '../src/utils/core.js';

console.log("--- Alpha Strategy Verification: Time Decay ---");

const marginPercent = 10;
const fairValue = 50;

// Case 1: Game is far in the future (24 hours)
const marketFar = {
    isMatchFound: true,
    fairValue: fairValue,
    bestBid: 40,
    bestAsk: 60,
    volatility: 0,
    commenceTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
};

// Case 2: Game is starting soon (30 minutes)
const marketNear = {
    isMatchFound: true,
    fairValue: fairValue,
    bestBid: 40,
    bestAsk: 60,
    volatility: 0,
    commenceTime: new Date(Date.now() + 30 * 60 * 1000).toISOString()
};

const resultFar = calculateStrategy(marketFar, marginPercent);
const resultNear = calculateStrategy(marketNear, marginPercent);

console.log(`Far Future Market (24h): Max Willing to Pay = ${resultFar.maxWillingToPay}¢`);
console.log(`Near Future Market (30m): Max Willing to Pay = ${resultNear.maxWillingToPay}¢`);

const diff = resultFar.maxWillingToPay - resultNear.maxWillingToPay;
console.log(`Difference (Far - Near): ${diff}¢`);

if (diff === 0) {
    console.log("FAIL: Strategy treats near-term and long-term markets identically. Time decay is missing.");
    process.exit(1);
} else {
    console.log("PASS: Strategy adjusts for time decay.");
    process.exit(0);
}
