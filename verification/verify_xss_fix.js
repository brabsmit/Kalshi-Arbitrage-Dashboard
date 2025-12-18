
const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
};

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

// Mock Data
const maliciousData = {
    timestamp: Date.now(),
    ticker: "TICKER",
    event: "Event",
    action: "BID",
    odds: 100,
    fairValue: "<script>alert('XSS')</script>", // Malicious payload
    bidPrice: "=1+1", // CSV Injection payload
    edge: 10,
    status: "Active",
    pnl: 100,
    outcome: "Yes",
    latency: 10,
    bookmakerCount: 5,
    oddsSpread: 0.05,
    vigFreeProb: 50
};

const data = [maliciousData];

// Simulate printReport HTML generation (FIXED VERSION)
const htmlOutput = data.map(d => `
    <tr>
        <td>${new Date(d.timestamp).toLocaleString()}</td>
        <td>${escapeHtml(d.event)}</td>
        <td>${escapeHtml(d.ticker)}</td>
        <td>${escapeHtml(d.fairValue)}</td>
        <td>${escapeHtml(d.bidPrice)}</td>
        <td>${escapeHtml(d.edge)}</td>
        <td>${d.latency !== null ? d.latency : '-'}</td>
        <td>${Number(d.oddsSpread).toFixed(3)}</td>
        <td>${escapeHtml(d.status)}</td>
        <td class="${d.pnl >= 0 ? 'positive' : 'negative'}">${(d.pnl / 100).toFixed(2)}</td>
    </tr>
`).join('');

console.log("--- HTML Output ---");
console.log(htmlOutput);

if (htmlOutput.includes("&lt;script&gt;alert('XSS')&lt;/script&gt;")) {
    console.log("✅ HTML SAFE: Script tag escaped.");
} else if (htmlOutput.includes("<script>")) {
    console.log("🚨 HTML VULNERABLE: Script tag found!");
} else {
    console.log("❓ Unexpected HTML output.");
}

// Simulate downloadCSV Row generation (FIXED VERSION)
const csvRow = data.map(d => [
    new Date(d.timestamp).toISOString(),
    escapeCSV(d.ticker),
    escapeCSV(d.event),
    escapeCSV(d.action),
    escapeCSV(d.odds),
    escapeCSV(d.fairValue),
    escapeCSV(d.bidPrice),
    escapeCSV(d.edge),
    escapeCSV(d.status),
    d.pnl,
    escapeCSV(d.outcome),
    d.latency !== null ? d.latency : '',
    d.bookmakerCount,
    Number(d.oddsSpread).toFixed(3),
    Number(d.vigFreeProb).toFixed(2)
])[0];

console.log("\n--- CSV Row ---");
console.log(csvRow.join(","));

if (csvRow[5] === '"<script>alert(\'XSS\')</script>"') {
     console.log("✅ CSV SAFE: fairValue escaped (quoted).");
} else {
     console.log(`🚨 CSV CHECK FAILED for fairValue: ${csvRow[5]}`);
}

if (csvRow[6] === "'=1+1") { // Should be escaped with leading quote and NO extra quotes if it was not string? Wait.
    // escapeCSV("=1+1") -> "'=1+1" -> then wrapping in quotes: "\"'=1+1\""
    // Wait, escapeCSV returns `"${escaped}"`.
    // let escaped = "=1+1";
    // if (/^[=+\-@]/.test(escaped)) escaped = "'" + escaped; // "'=1+1"
    // return `"${escaped}"`; // "\"'=1+1\""

    // My mock data bidPrice is "=1+1" (string)
    // escapeCSV("=1+1") should return "\"'=1+1\""
    // Wait.
    // If bidPrice is passed as string, escapeCSV logic:
    // escaped = "=1+1".
    // test /^[=+\-@]/ matches.
    // escaped = "'=1+1".
    // return `"'=1+1"`.
    // So output is "'=1+1" (inside the array).
    // The console log will show it joined by comma.
}

const expectedCSVPrice = `"'=1+1"`;
if (csvRow[6] === expectedCSVPrice) {
    console.log("✅ CSV SAFE: Formula injection prevented.");
} else {
    console.log(`🚨 CSV CHECK FAILED for bidPrice: ${csvRow[6]} (Expected: ${expectedCSVPrice})`);
}
