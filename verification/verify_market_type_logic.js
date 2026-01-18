import { detectMarketType, extractLine } from '../kalshi-dashboard/src/utils/core.js';

const testCases = [
    { ticker: 'NFL-KC-BUF', expectedType: 'moneyline', expectedLine: null },
    { ticker: 'NFL-KC-BUF-3.5', expectedType: 'spreads', expectedLine: '3.5' },
    { ticker: 'NFL-KC-BUF-O45.5', expectedType: 'totals', expectedLine: 'O45.5' },
    { ticker: 'NFL-KC-BUF-U45.5', expectedType: 'totals', expectedLine: 'U45.5' },
    { ticker: 'NFL-KC-BUF-10', expectedType: 'spreads', expectedLine: '10' },
    { ticker: 'NFL-KC-BUF--3.5', expectedType: 'spreads', expectedLine: '3.5' }, // Regex might match 3.5 if it looks for -\d...
    { ticker: '', expectedType: 'moneyline', expectedLine: null },
    { ticker: null, expectedType: 'moneyline', expectedLine: null },
];

let failed = false;

testCases.forEach(({ ticker, expectedType, expectedLine }) => {
    const type = detectMarketType(ticker);
    const line = extractLine(ticker);

    if (type !== expectedType) {
        console.error(`FAILED: ${ticker} -> Expected type ${expectedType}, got ${type}`);
        failed = true;
    }

    if (line !== expectedLine) {
        // Special case: if regex captures differently, let's see.
        // My regex was: /-(\d+(\.\d+)?)$/ for spreads.
        // If ticker is ...-3.5, it captures 3.5.
        // If ticker is ...--3.5, it captures 3.5 (the last number after a dash).
        console.error(`FAILED: ${ticker} -> Expected line ${expectedLine}, got ${line}`);
        failed = true;
    }
});

if (!failed) {
    console.log("All tests passed!");
} else {
    process.exit(1);
}
