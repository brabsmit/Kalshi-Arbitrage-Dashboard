
import { calculateStrategy } from '../kalshi-dashboard/src/utils/core.js';

console.log("--- VERIFYING TIMER STRATEGY ---");

const now = Date.now();
const oneHour = 60 * 60 * 1000;

// Create mock markets
const marketBase = {
    isMatchFound: true,
    fairValue: 50,
    bestBid: 40,
    bestAsk: 60,
    volatility: 0
};

const markets = [
    {
        ...marketBase,
        name: "Imminent (30m)",
        commenceTime: new Date(now + 0.5 * oneHour).toISOString()
    },
    {
        ...marketBase,
        name: "Near Term (3h)",
        commenceTime: new Date(now + 3 * oneHour).toISOString()
    },
    {
        ...marketBase,
        name: "Far Term (24h)",
        commenceTime: new Date(now + 24 * oneHour).toISOString()
    }
];

const marginPercent = 10; // 10% base margin

markets.forEach(m => {
    const result = calculateStrategy(m, marginPercent);
    const impliedMargin = 1 - (result.maxWillingToPay / m.fairValue);

    console.log(`\nMarket: ${m.name}`);
    console.log(`  Start: ${m.commenceTime}`);
    console.log(`  FairValue: ${m.fairValue}`);
    console.log(`  MaxWillingToPay: ${result.maxWillingToPay}`);
    console.log(`  Implied Margin: ${(impliedMargin * 100).toFixed(1)}%`);

    // Check if expected margin matches
    // Note: calculateStrategy does Math.floor, so there might be slight rounding diffs
});
