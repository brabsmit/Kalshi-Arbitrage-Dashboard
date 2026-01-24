
import { calculateStrategy } from '../kalshi-dashboard/src/utils/core.js';

const now = Date.now();
const oneHour = 60 * 60 * 1000;
const tenMinutes = 10 * 60 * 1000;

const baseMargin = 10;
const fairValue = 50;

const marketTemplate = {
    isMatchFound: true,
    fairValue: fairValue,
    bestBid: 40,
    bestAsk: 60,
    volatility: 0
};

console.log("--- Verifying Timer Strategy ---");

// Case 1: Long time until commence (> 6 hours)
const marketLong = {
    ...marketTemplate,
    commenceTime: new Date(now + 7 * oneHour).toISOString()
};
const strategyLong = calculateStrategy(marketLong, baseMargin);
console.log(`Long (>6h): Margin ${baseMargin}%, Expected MaxPay 45, Got ${strategyLong.maxWillingToPay}`);

// Case 2: Short time until commence (< 6 hours, > 1 hour)
const marketShort = {
    ...marketTemplate,
    commenceTime: new Date(now + 2 * oneHour).toISOString()
};
const strategyShort = calculateStrategy(marketShort, baseMargin);
console.log(`Short (<6h): Margin ${baseMargin}%, Expected MaxPay 43, Got ${strategyShort.maxWillingToPay}`);

// Case 3: Very short time until commence (< 1 hour)
const marketVeryShort = {
    ...marketTemplate,
    commenceTime: new Date(now + 30 * 60 * 1000).toISOString()
};
const strategyVeryShort = calculateStrategy(marketVeryShort, baseMargin);
console.log(`Very Short (<1h): Margin ${baseMargin}%, Expected MaxPay 42, Got ${strategyVeryShort.maxWillingToPay}`);

// Verification Logic
if (strategyLong.maxWillingToPay === 45 && strategyShort.maxWillingToPay === 43 && strategyVeryShort.maxWillingToPay === 42) {
    console.log("SUCCESS: Timer Strategy is working as expected.");
} else {
    console.error("FAILURE: Timer Strategy values are incorrect.");
    process.exit(1);
}
