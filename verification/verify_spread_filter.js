
import { calculateStrategy } from '../kalshi-dashboard/src/utils/core.js';

// Mock Markets
const wideSpreadMarket = {
    isMatchFound: true,
    fairValue: 50,
    bestBid: 10,
    bestAsk: 90,
    ticker: 'TEST-WIDE'
};

const tightSpreadMarket = {
    isMatchFound: true,
    fairValue: 50,
    bestBid: 48,
    bestAsk: 52,
    ticker: 'TEST-TIGHT'
};

const oneSidedMarket = {
    isMatchFound: true,
    fairValue: 50,
    bestBid: 40,
    bestAsk: null, // No sellers
    ticker: 'TEST-ONESIDED'
};

const margin = 10; // 10% margin

console.log("--- Verifying Strategy ---");

const resWide = calculateStrategy(wideSpreadMarket, margin);
console.log(`Wide Spread (10/90): Bid=${resWide.smartBid}, Reason=${resWide.reason}`);

const resTight = calculateStrategy(tightSpreadMarket, margin);
console.log(`Tight Spread (48/52): Bid=${resTight.smartBid}, Reason=${resTight.reason}`);

const resOneSided = calculateStrategy(oneSidedMarket, margin);
console.log(`One Sided (40/--): Bid=${resOneSided.smartBid}, Reason=${resOneSided.reason}`);

// Check expectations (Pre-change, we expect bids on all)
if (resWide.smartBid !== null) {
    console.log("Current behavior: Bids on wide spreads.");
}

if (resTight.smartBid !== null) {
    console.log("Current behavior: Bids on tight spreads.");
}
