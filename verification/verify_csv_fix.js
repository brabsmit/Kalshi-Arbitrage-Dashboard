
const escapeCSV = (str) => {
    if (str === null || str === undefined) return '""';
    let escaped = String(str).replace(/"/g, '""');
    if (/^[=+\-@]/.test(escaped)) {
        escaped = "'" + escaped;
    }
    return `"${escaped}"`;
};

// Simulation of fixed code
const maliciousData = {
    bookmakerCountRaw: "=cmd|' /C calc'!A0",
};

// Step 1: Sanitization in generateSessionData
const bookmakerCount = Number(maliciousData.bookmakerCountRaw || 0);

// Step 2: Escaping in downloadCSV
const row = [
    escapeCSV(bookmakerCount)
];

const csvLine = row.join(",");

console.log("Fixed CSV Line:", csvLine);

if (csvLine.includes("=cmd|")) {
    console.log("FAIL: Malicious payload still present.");
} else if (csvLine === '"NaN"') {
    console.log("SUCCESS: Payload converted to NaN and quoted.");
} else if (csvLine === '"0"') {
     console.log("SUCCESS: Payload converted to 0.");
} else {
    console.log("SUCCESS: Payload neutralized.");
}
