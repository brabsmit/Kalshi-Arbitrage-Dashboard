
import { calculateStrategy, calculateKalshiFees } from '../kalshi-dashboard/src/utils/core.js';

console.log("Verifying Fee Strategy Logic...");

let failed = false;

// ==========================================
// TEST CASE 1: Negative EV Avoidance
// ==========================================
// Fair Value: 52c
// Best Ask: 51c
// Fee: 2c
// Cost: 53c
// PnL: -1c
// EXPECTED: DO NOT TAKE ASK

{
    console.log("\n--- Test Case 1: Negative EV Avoidance ---");
    const market = {
        isMatchFound: true,
        fairValue: 52,
        volatility: 0,
        bestBid: 40,
        bestAsk: 51
    };
    const marginPercent = 0;
    const result = calculateStrategy(market, marginPercent);
    const fee = calculateKalshiFees(market.bestAsk, 1);
    const projectedPnL = market.fairValue - (market.bestAsk + fee);

    console.log(`Fair Value: ${market.fairValue}, Ask: ${market.bestAsk}, Fee: ${fee}, PnL: ${projectedPnL}`);
    console.log(`Action: ${result.reason}, Bid: ${result.smartBid}`);

    if (result.reason === "Take Ask") {
        console.log("FAIL: Taken negative EV trade.");
        failed = true;
    } else {
        console.log("PASS: Avoided negative EV trade.");
    }
}

// ==========================================
// TEST CASE 2: Positive EV Execution
// ==========================================
// Fair Value: 55c
// Best Ask: 51c
// Fee: 2c
// Cost: 53c
// PnL: +2c
// EXPECTED: TAKE ASK

{
    console.log("\n--- Test Case 2: Positive EV Execution ---");
    const market = {
        isMatchFound: true,
        fairValue: 55,
        volatility: 0,
        bestBid: 40,
        bestAsk: 51
    };
    const marginPercent = 0;
    const result = calculateStrategy(market, marginPercent);
    const fee = calculateKalshiFees(market.bestAsk, 1);
    const projectedPnL = market.fairValue - (market.bestAsk + fee);

    console.log(`Fair Value: ${market.fairValue}, Ask: ${market.bestAsk}, Fee: ${fee}, PnL: ${projectedPnL}`);
    console.log(`Action: ${result.reason}, Bid: ${result.smartBid}`);

    if (result.reason === "Take Ask" && result.smartBid === 51) {
        console.log("PASS: Taken positive EV trade.");
    } else {
        console.log("FAIL: Missed positive EV trade.");
        failed = true;
    }
}

if (failed) {
    console.log("\nOVERALL STATUS: FAIL");
    process.exit(1);
} else {
    console.log("\nOVERALL STATUS: PASS");
}
