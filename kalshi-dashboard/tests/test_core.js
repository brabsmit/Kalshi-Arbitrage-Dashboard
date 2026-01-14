
import { formatDateTime, escapeHtml, escapeCSV } from '../src/utils/core.js';

console.log("Running Core Utils Tests...");

const dateStr = "2024-01-01T17:00:00.000Z";
const ts = new Date(dateStr).getTime();

console.log(`formatDateTime('${dateStr}'):`, formatDateTime(dateStr));
console.log(`formatDateTime(${ts}):`, formatDateTime(ts));

console.log(`escapeHtml('<script>'):`, escapeHtml('<script>'));
console.log(`escapeCSV('foo,bar'):`, escapeCSV('foo,bar'));
console.log(`escapeCSV('=1+1'):`, escapeCSV('=1+1'));

// Validation
const formatted = formatDateTime(dateStr);
if (formatted.includes("Jan 1") && formatted.includes("5:00 PM")) {
    console.log("PASS: formatDateTime");
} else {
    console.error("FAIL: formatDateTime output:", formatted);
    process.exit(1);
}

if (escapeHtml('<') === '&lt;') console.log("PASS: escapeHtml");
else {
    console.error("FAIL: escapeHtml");
    process.exit(1);
}

if (escapeCSV('a,b') === '"a,b"') console.log("PASS: escapeCSV quoting");
else {
    console.error("FAIL: escapeCSV quoting");
    process.exit(1);
}

if (escapeCSV('=cmd') === "'=cmd") console.log("PASS: escapeCSV injection");
else {
    console.error("FAIL: escapeCSV injection");
    process.exit(1);
}
