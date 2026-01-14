const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '../src/App.jsx');
const content = fs.readFileSync(appPath, 'utf8');

// Check for the specific inline script pattern in printReport
const scriptPattern = /<script>\s*window\.onload\s*=\s*function\(\)\s*\{\s*window\.print\(\);\s*\}\s*<\/script>/;

if (scriptPattern.test(content)) {
    console.log("VULNERABILITY FOUND: Inline script detected in printReport.");
    process.exit(1); // Fail if found
} else {
    // Check if the new logic is present
    const newLogic = /printWindow\.onload\s*=\s*\(\)\s*=>\s*\{\s*printWindow\.focus\(\);\s*printWindow\.print\(\);\s*\};/;
    if (newLogic.test(content)) {
        console.log("SUCCESS: Inline script removed and parent context onload handler added.");
        process.exit(0);
    } else {
        console.log("Warning: Inline script removed but new print logic not found or format mismatch?");
        // Fallback check for less strict format
        if (content.includes('printWindow.onload = () => {') && content.includes('printWindow.print();')) {
             console.log("SUCCESS: Inline script removed and parent context onload handler detected (loose check).");
             process.exit(0);
        }
        process.exit(1);
    }
}
