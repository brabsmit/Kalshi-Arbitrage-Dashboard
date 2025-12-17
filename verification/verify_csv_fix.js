
const assert = require('assert');

// Logic from App.jsx (FIXED)
const escapeCSV = (str) => {
    if (typeof str !== 'string') return str;
    // Escape double quotes by doubling them
    let escaped = str.replace(/"/g, '""');
    // Prevent formula injection (CSV Injection) if starts with =, +, -, @
    if (/^[=+\-@]/.test(escaped)) {
        escaped = "'" + escaped;
    }
    return `"${escaped}"`;
};

const maliciousInput = "=cmd|' /C calc'!A0";
console.log("Testing FIXED logic...");
const output = escapeCSV(maliciousInput);
console.log(`Input: ${maliciousInput}`);
console.log(`Output: ${output}`);

if (output.startsWith('"=')) {
    console.error("VULNERABILITY DETECTED: Output still starts with \"= .");
    process.exit(1);
} else if (output === `"'=cmd|' /C calc'!A0"`) {
    console.log("SUCCESS: Output is correctly escaped with single quote.");
} else {
    console.log("SUCCESS: Output is safe (though check format): " + output);
}

// Test ticker escaping (comma)
const ticker = "KX,TEST";
const tickerOutput = escapeCSV(ticker);
console.log(`Ticker Input: ${ticker}`);
console.log(`Ticker Output: ${tickerOutput}`);
if (tickerOutput !== `"KX,TEST"`) {
    console.error("FAIL: Ticker not correctly quoted.");
    process.exit(1);
} else {
    console.log("SUCCESS: Ticker quoted.");
}
