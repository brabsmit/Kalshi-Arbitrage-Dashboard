
import { calculateStrategy } from '../kalshi-dashboard/src/utils/core.js';

const mockMarket = {
    isMatchFound: true,
    fairValue: 50,
    bestBid: 40,
    bestAsk: 60,
    commenceTime: new Date(Date.now() + 48 * 3600 * 1000).toISOString(), // 48 hours out
};

const margin = 10; // 10% margin

console.log("--- Time Decay Strategy Verification ---");

// Test Base (> 24h)
const baseResult = calculateStrategy(mockMarket, margin);
console.log(`Base (48h): MaxPay=${baseResult.maxWillingToPay} (Expected 45)`);
if (baseResult.maxWillingToPay !== 45) console.error("FAIL: Base calculation incorrect");

// Test Near (< 24h)
const nearMarket = { ...mockMarket, commenceTime: new Date(Date.now() + 12 * 3600 * 1000).toISOString() };
const nearResult = calculateStrategy(nearMarket, margin);
console.log(`Near (12h): MaxPay=${nearResult.maxWillingToPay} (Expected 44)`);
if (nearResult.maxWillingToPay !== 44) console.error("FAIL: Near calculation incorrect");

// Test Urgent (< 1h)
const urgentMarket = { ...mockMarket, commenceTime: new Date(Date.now() + 0.5 * 3600 * 1000).toISOString() };
const urgentResult = calculateStrategy(urgentMarket, margin);
console.log(`Urgent (0.5h): MaxPay=${urgentResult.maxWillingToPay} (Expected 42)`);
if (urgentResult.maxWillingToPay !== 42) console.error("FAIL: Urgent calculation incorrect");

if (baseResult.maxWillingToPay > nearResult.maxWillingToPay && nearResult.maxWillingToPay > urgentResult.maxWillingToPay) {
    console.log("SUCCESS: Margin increases (price decreases) as time-to-event reduces.");
} else {
    console.log("FAIL: Logic does not correctly decay price.");
}
