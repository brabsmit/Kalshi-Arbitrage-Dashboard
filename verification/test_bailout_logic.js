
import { processBailOuts } from '../kalshi-dashboard/src/bot/bailOut.js';

// Mock dependencies
const mockLog = [];
const addLog = (msg, type) => mockLog.push({ msg, type });

const mockOrderManager = {
    cancelOrder: async (id) => {
        mockLog.push({ msg: `Cancelled ${id}`, type: 'CANCEL' });
    },
    executeBailOutOrder: async (ticker, price, qty, side) => {
        mockLog.push({ msg: `Executed Bailout ${ticker} @ ${price}`, type: 'EXEC' });
        return { success: true };
    }
};

const config = {
    isBailOutEnabled: true,
    bailOutHoursBeforeExpiry: 24,
    bailOutTriggerPercent: 20
};

// Test Data
const now = Date.now();
const positions = [
    {
        marketId: 'TICKER-BAILOUT',
        side: 'Yes',
        avgPrice: 50,
        quantity: 10,
        status: 'HELD',
        settlementStatus: 'unsettled',
        isOrder: false
    },
    {
        marketId: 'TICKER-SAFE',
        side: 'Yes',
        avgPrice: 50,
        quantity: 10,
        status: 'HELD',
        settlementStatus: 'unsettled',
        isOrder: false
    }
];

const markets = [
    {
        realMarketId: 'TICKER-BAILOUT',
        commenceTime: new Date(now + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
        bestBid: 30 // Down 40% ( (30-50)/50 = -0.4 )
    },
    {
        realMarketId: 'TICKER-SAFE',
        commenceTime: new Date(now + 48 * 60 * 60 * 1000).toISOString(), // 48 hours from now
        bestBid: 45 // Down 10%
    }
];

async function runTest() {
    console.log("Running processBailOuts test...");
    const result = await processBailOuts(positions, markets, config, mockOrderManager, addLog);

    console.log("Result:", result);
    console.log("Logs:", mockLog);

    if (result.includes('TICKER-BAILOUT') && !result.includes('TICKER-SAFE')) {
        console.log("Test Passed: Correctly identified bailout candidate.");
    } else {
        console.error("Test Failed: Incorrect identification.");
        process.exit(1);
    }
}

runTest();
