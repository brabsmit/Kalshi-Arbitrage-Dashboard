import { calculateStrategy } from '../kalshi-dashboard/src/utils/core.js';

const now = Date.now();
const ONE_HOUR = 60 * 60 * 1000;

// Mock markets
const baseMarket = {
    isMatchFound: true,
    fairValue: 50, // 50 cents
    bestBid: 40,
    bestAsk: 60,
    volatility: 0,
    commenceTime: new Date(now + 25 * ONE_HOUR).toISOString() // > 24 hours
};

const markets = [
    { ...baseMarket, name: "Long Term (>24h)", commenceTime: new Date(now + 25 * ONE_HOUR).toISOString() },
    { ...baseMarket, name: "Medium Term (<24h)", commenceTime: new Date(now + 5 * ONE_HOUR).toISOString() },
    { ...baseMarket, name: "Short Term (<1h)", commenceTime: new Date(now + 0.5 * ONE_HOUR).toISOString() }
];

const marginPercent = 10; // 10% base margin

console.log("Running Timer Strategy Verification...");
console.log(`Base Margin: ${marginPercent}%`);
console.log(`Fair Value: ${baseMarket.fairValue}¢`);
console.log("-".repeat(60));
console.log(String("Scenario").padEnd(20) + String("Commence In").padEnd(15) + String("MaxPay").padEnd(10) + String("Implied Margin").padEnd(15));
console.log("-".repeat(60));

markets.forEach(m => {
    const result = calculateStrategy(m, marginPercent);
    const maxPay = result.maxWillingToPay;

    // Reverse engineer effective margin: maxPay = FV * (1 - margin) => margin = 1 - (maxPay / FV)
    const impliedMargin = (1 - (maxPay / m.fairValue)) * 100;

    const timeToStart = (new Date(m.commenceTime).getTime() - now) / ONE_HOUR;

    console.log(
        m.name.padEnd(20) +
        `${timeToStart.toFixed(1)}h`.padEnd(15) +
        `${maxPay}¢`.padEnd(10) +
        `${impliedMargin.toFixed(1)}%`
    );
});

console.log("-".repeat(60));
