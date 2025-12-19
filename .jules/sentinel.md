## 2024-05-22 - Client-Side XSS in Report Generation
**Vulnerability:** The `DataExportModal` component generated HTML reports by directly injecting API data (event names, tickers) into a `window.open` popup using `document.write`. This allowed malicious event names (e.g., `<script>...`) to execute arbitrary JavaScript in the user's browser context.
**Learning:** This existed because the application logic trusted API data implicitly and used `document.write` for quick report generation without sanitization. In a client-side wallet app (storing keys in `localStorage`), this is critical as it allows key exfiltration.
**Prevention:** Always sanitize or escape user-controlled or external data before rendering it into HTML, especially when using raw HTML insertion methods like `innerHTML` or `document.write`. Use a helper like `escapeHtml`.

## 2024-05-22 - CSV Injection in Data Export
**Vulnerability:** User-controlled data (Event names, Tickers) exported to CSV were not sanitized for formula injection.
**Learning:** Even in dashboards, "Export to CSV" features are attack vectors if opened in Excel. `escapeHtml` is insufficient for CSV.
**Prevention:** Always escape fields starting with `=, +, -, @` when generating CSVs.

## 2025-12-19 - Vite Dev Server Security Headers
**Vulnerability:** The Vite development server was exposed to the local network (`host: true`) without security headers, making it potentially vulnerable to Clickjacking or MIME sniffing attacks if accessed by other users on the network.
**Learning:** Even development servers, when exposed to a network, should implement defense-in-depth measures. `vite.config.js` allows injection of headers via `server.headers`.
**Prevention:** Add `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy` to the `server.headers` configuration in Vite.
