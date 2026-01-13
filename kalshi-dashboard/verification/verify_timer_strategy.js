
import { calculateStrategy } from '../src/utils/core.js';

// Mock market factory
const createMarket = (hoursUntilStart, fairValue = 50, bestBid = 40, bestAsk = 60, volatility = 0) => {
    const now = Date.now();
    const commenceTime = new Date(now + hoursUntilStart * 60 * 60 * 1000).toISOString();
    return {
        isMatchFound: true,
        fairValue,
        bestBid,
        bestAsk,
        volatility,
        commenceTime
    };
};

const runTest = () => {
    console.log("--- Alpha Strategy Verification: The Timer ---");
    const marginPercent = 10;

    const scenarios = [
        { name: "Live/Started", hours: -1 },
        { name: "Imminent (< 1h)", hours: 0.5 },
        { name: "Near Term (< 24h)", hours: 12 },
        { name: "Mid Term (48h)", hours: 48 },
        { name: "Long Term (7d)", hours: 168 }
    ];

    scenarios.forEach(scenario => {
        const market = createMarket(scenario.hours);
        const result = calculateStrategy(market, marginPercent);

        console.log(`\nScenario: ${scenario.name}`);
        console.log(`Fair Value: ${market.fairValue}¢`);
        console.log(`Base Margin: ${marginPercent}%`);
        console.log(`Max Willing to Pay: ${result.maxWillingToPay}¢`);
        console.log(`Implied Effective Margin: ${((1 - result.maxWillingToPay / market.fairValue) * 100).toFixed(2)}%`);
    });
};

runTest();
