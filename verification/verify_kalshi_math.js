import KalshiMath from '../kalshi-dashboard/src/utils/KalshiMath.js';

console.log('Running KalshiMath verification (Integer Math)...');

let failures = 0;

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAILED: ${message}`);
        failures++;
    } else {
        console.log(`✅ PASSED: ${message}`);
    }
}

// Test calculateFee
console.log('\nTesting calculateFee...');

// Case 1: Taker, 10 contracts @ 50c
// Fee = ceil(0.07 * 10 * 0.50 * 0.50 * 100) = ceil(17.5) = 18
const fee1 = KalshiMath.calculateFee(50, 10, true);
assert(fee1 === 18, `Taker 10 @ 50c should be 18c, got ${fee1}c`);

// Case 2: Maker, 10 contracts @ 50c
// Fee = ceil(0.0175 * 10 * 0.50 * 0.50 * 100) = ceil(4.375) = 5
const fee2 = KalshiMath.calculateFee(50, 10, false);
assert(fee2 === 5, `Maker 10 @ 50c should be 5c, got ${fee2}c`);

// Case 3: Taker, 100 contracts @ 99c
// Fee = ceil(0.07 * 100 * 0.99 * 0.01 * 100) = ceil(6.93) = 7
const fee3 = KalshiMath.calculateFee(99, 100, true);
assert(fee3 === 7, `Taker 100 @ 99c should be 7c, got ${fee3}c`);

// Case 4: Zero quantity
const fee4 = KalshiMath.calculateFee(50, 0, true);
assert(fee4 === 0, `Zero quantity should be 0c, got ${fee4}c`);

// Case 5: Floating Point Error Check (The Critical Test)
// Taker, 4 contracts @ 50c
// Float Math: 0.07 * 4 * 0.5 * 0.5 * 100 = 7.000000000000001 -> ceil -> 8 (WRONG)
// Integer Math: (7 * 4 * 50 * 50) / 10000 = 70000 / 10000 = 7 -> ceil -> 7 (CORRECT)
const fee5 = KalshiMath.calculateFee(50, 4, true);
assert(fee5 === 7, `Taker 4 @ 50c (Float Bug Case) should be 7c, got ${fee5}c`);

// Case 6: Maker, 400 contracts @ 50c
// Rate 0.0175 (7/400).
// Fee = 0.0175 * 400 * 0.5 * 0.5 * 100 = 175 cents.
// Integer: (175 * 400 * 50 * 50) / 1000000 = 175000000 / 1000000 = 175.
const fee6 = KalshiMath.calculateFee(50, 400, false);
assert(fee6 === 175, `Maker 400 @ 50c should be 175c, got ${fee6}c`);

// Test calculateBreakEvenSellPrice
console.log('\nTesting calculateBreakEvenSellPrice...');

// Case 1: Buy 10 @ 50c (Taker Entry) -> Seek Taker Exit
// Entry Cost = (10 * 50) + 18 = 518c.
const be1 = KalshiMath.calculateBreakEvenSellPrice(518, 10, true);
assert(be1 === 54, `Break even for Cost 518, Qty 10 should be 54c, got ${be1}c`);

// Case 2: Buy 100 @ 1c (Taker Entry)
// Fee = 7c. Cost = 107c.
const be2 = KalshiMath.calculateBreakEvenSellPrice(107, 100, true);
assert(be2 === 2, `Break even for Cost 107, Qty 100 should be 2c, got ${be2}c`);

if (failures === 0) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
} else {
    console.error(`\n❌ ${failures} tests failed.`);
    process.exit(1);
}
