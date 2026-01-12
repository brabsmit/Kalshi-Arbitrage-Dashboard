
import { calculateStrategy } from '../src/utils/core.js';

console.log("=== ALPHA: Verifying The Timer Strategy ===");

const baseMarket = {
    isMatchFound: true,
    fairValue: 50, // 50 cents
    bestBid: 40,
    bestAsk: 60,
    volatility: 0,
    commenceTime: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() // 48 hours away
};

const margin = 10; // 10% margin. MaxWilling = 50 * 0.9 = 45.

// Case 1: Long term (48h)
const resLong = calculateStrategy(baseMarket, margin);
console.log(`[> 24h] FairValue: ${baseMarket.fairValue}, Margin: ${margin}%, MaxPay: ${resLong.maxWillingToPay}`);

// Case 2: Near term (20h)
const marketNear = { ...baseMarket, commenceTime: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString() };
const resNear = calculateStrategy(marketNear, margin);
console.log(`[< 24h] FairValue: ${marketNear.fairValue}, Margin: ${margin}%, MaxPay: ${resNear.maxWillingToPay}`);

// Case 3: Immediate (30 mins)
const marketImmediate = { ...baseMarket, commenceTime: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
const resImmediate = calculateStrategy(marketImmediate, margin);
console.log(`[< 1h]  FairValue: ${marketImmediate.fairValue}, Margin: ${margin}%, MaxPay: ${resImmediate.maxWillingToPay}`);

// Case 4: Past (Started 10 mins ago)
const marketPast = { ...baseMarket, commenceTime: new Date(Date.now() - 10 * 60 * 1000).toISOString() };
const resPast = calculateStrategy(marketPast, margin);
console.log(`[Past]  FairValue: ${marketPast.fairValue}, Margin: ${margin}%, MaxPay: ${resPast.maxWillingToPay}`);

console.log("===========================================");
