
const escapeCSV = (str) => {
    if (str === null || str === undefined) return '""';
    // Escape double quotes by doubling them
    let escaped = String(str).replace(/"/g, '""');
    // Prevent formula injection (CSV Injection) if starts with =, +, -, @
    if (/^[=+\-@]/.test(escaped)) {
        escaped = "'" + escaped;
    }
    return `"${escaped}"`;
};

// Mock data as it appears in generateSessionData
const maliciousData = {
    bookmakerCount: "=cmd|' /C calc'!A0", // Malicious payload
    oddsSpread: 0.05,
    vigFreeProb: 55.5
};

// Simulation of downloadCSV logic
const row = [
    // ... other fields skipped
    maliciousData.bookmakerCount,
    Number(maliciousData.oddsSpread).toFixed(3),
    Number(maliciousData.vigFreeProb).toFixed(2)
];

const csvLine = row.join(",");

console.log("Generated CSV Line:", csvLine);

if (csvLine.includes("=cmd|")) {
    console.log("VULNERABILITY CONFIRMED: Malicious payload present in CSV.");
} else {
    console.log("SAFE: Payload escaped or modified.");
}
