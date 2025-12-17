## 2024-05-22 - Client-Side XSS in Report Generation
**Vulnerability:** The `DataExportModal` component generated HTML reports by directly injecting API data (event names, tickers) into a `window.open` popup using `document.write`. This allowed malicious event names (e.g., `<script>...`) to execute arbitrary JavaScript in the user's browser context.
**Learning:** This existed because the application logic trusted API data implicitly and used `document.write` for quick report generation without sanitization. In a client-side wallet app (storing keys in `localStorage`), this is critical as it allows key exfiltration.
**Prevention:** Always sanitize or escape user-controlled or external data before rendering it into HTML, especially when using raw HTML insertion methods like `innerHTML` or `document.write`. Use a helper like `escapeHtml`.

## 2024-05-22 - CSV Injection in Data Export
**Vulnerability:** User-controlled data (Event names, Tickers) exported to CSV were not sanitized for formula injection.
**Learning:** Even in dashboards, "Export to CSV" features are attack vectors if opened in Excel. `escapeHtml` is insufficient for CSV.
**Prevention:** Always escape fields starting with `=, +, -, @` when generating CSVs.
