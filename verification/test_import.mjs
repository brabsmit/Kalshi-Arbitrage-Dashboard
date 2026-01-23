
import { calculateStrategy } from '../kalshi-dashboard/src/utils/core.js';

const market = {
    isMatchFound: true,
    fairValue: 50,
    bestBid: 48,
    bestAsk: 52,
    commenceTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
    volatility: 0
};

const result = calculateStrategy(market, 10);
console.log('Result:', result);
