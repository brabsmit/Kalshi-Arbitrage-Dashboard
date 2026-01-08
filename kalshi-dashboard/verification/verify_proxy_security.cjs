
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../vite.config.js');
const configContent = fs.readFileSync(configPath, 'utf8');

// The expected secure logic (Now improved)
const expectedLogic = "secure: isSecureTarget(process.env.KALSHI_API_URL)";

if (!configContent.includes(expectedLogic)) {
    console.error("❌ Verification Failed: Secure proxy logic not found in vite.config.js");
    console.error("Expected to find:", expectedLogic);
    process.exit(1);
}

// Check that it appears twice (once for REST, once for WS)
const occurrences = configContent.split(expectedLogic).length - 1;
if (occurrences < 2) {
    console.error(`❌ Verification Failed: Secure logic found ${occurrences} times, expected 2.`);
    process.exit(1);
}

// Check for the helper function definition
if (!configContent.includes("const isSecureTarget")) {
    console.error("❌ Verification Failed: Helper function 'isSecureTarget' not found.");
    process.exit(1);
}

// Check that secure: false is not present unconditionally
const insecureRegex = /secure:\s*false\s*,/g;
if (insecureRegex.test(configContent)) {
    console.error("❌ Verification Failed: Found unconditional 'secure: false'.");
    process.exit(1);
}

console.log("✅ Verification Passed: Proxy configuration is secure.");
