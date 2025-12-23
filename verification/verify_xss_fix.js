
const escapeHtml = (unsafe) => {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
};

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

if (htmlOutput.includes("&lt;script&gt;alert(&#039;XSS&#039;)&lt;/script&gt;") || htmlOutput.includes("&lt;script&gt;alert('XSS')&lt;/script&gt;")) {
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

const expectedCSVPrice = `"'=1+1"`;
if (csvRow[6] === expectedCSVPrice) {
    console.log("✅ CSV SAFE: Formula injection prevented.");
} else {
    console.log(`🚨 CSV CHECK FAILED for bidPrice: ${csvRow[6]} (Expected: ${expectedCSVPrice})`);
}
