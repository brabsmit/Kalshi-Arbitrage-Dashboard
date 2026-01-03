
const assert = require('assert');

// Mock implementation to verify logic in isolation
const escapeCSV = (str) => {
    if (str === null || str === undefined) return '';
    const s = String(str);
    let safe = s;
    if (/^[=+\-@]/.test(s)) {
        safe = "'" + s;
    }
    if (/[",\n\r]/.test(safe)) {
        return '"' + safe.replace(/"/g, '""') + '"';
    }
    return safe;
};

// Test Cases
try {
    // 1. Standard alphanumeric
    assert.strictEqual(escapeCSV("Hello"), "Hello");

    // 2. Contains comma (should quote)
    assert.strictEqual(escapeCSV("Hello, World"), '"Hello, World"');

    // 3. Contains quote (should double quote and wrap)
    assert.strictEqual(escapeCSV('Hello "World"'), '"Hello ""World"""');

    // 4. Formula Injection - Equals (should prepend ')
    assert.strictEqual(escapeCSV('=cmd|/C calc!A0'), '\'=cmd|/C calc!A0');

    // 5. Formula Injection - Plus
    assert.strictEqual(escapeCSV('+123'), "'+123");

    // 6. Formula Injection - Minus
    assert.strictEqual(escapeCSV('-123'), "'-123");

    // 7. Formula Injection - At
    assert.strictEqual(escapeCSV('@SUM(1+1)'), "'@SUM(1+1)");

    // 8. Formula AND Comma (should prepend ' THEN quote whole thing)
    // =1+1,2 -> '=1+1,2 -> "'=1+1,2"
    assert.strictEqual(escapeCSV('=1+1,2'), '"\'=1+1,2"');

    console.log("✅ All CSV Security Tests Passed");
} catch (e) {
    console.error("❌ Test Failed:", e.message);
    process.exit(1);
}
