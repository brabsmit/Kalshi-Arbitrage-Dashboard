
import { calculateStrategy } from '../kalshi-dashboard/src/utils/core.js';

console.log("🧠 Alpha Verification: The Timer Strategy");

const marginPercent = 10;
const fairValue = 50;
const bestBid = 40;
const bestAsk = 60;

const createMarket = (hoursUntilStart) => {
    const commenceTime = new Date(Date.now() + hoursUntilStart * 60 * 60 * 1000).toISOString();
    return {
        isMatchFound: true,
        fairValue,
        bestBid,
        bestAsk,
        commenceTime,
        volatility: 0.5
    };
};

const scenarios = [
    { label: "Game in 48 hours", hours: 48 },
    { label: "Game in 12 hours", hours: 12 },
    { label: "Game in 30 mins", hours: 0.5 },
];

scenarios.forEach(scen => {
    const market = createMarket(scen.hours);
    const result = calculateStrategy(market, marginPercent);
    console.log(`\n--- ${scen.label} ---`);
    console.log(`Margin: ${marginPercent}%`);
    console.log(`Max Willing to Pay: ${result.maxWillingToPay}¢`);
    console.log(`Smart Bid: ${result.smartBid}¢`);
});
