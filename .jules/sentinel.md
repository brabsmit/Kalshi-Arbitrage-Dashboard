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

## 2025-12-20 - Missing Content Security Policy (CSP)
**Vulnerability:** The application lacked a Content Security Policy (CSP), allowing execution of scripts from any source. This is a high risk for a wallet application that handles private keys.
**Learning:** Single Page Applications (SPAs) serving static HTML often miss CSP headers if not configured in the web server. Adding a `<meta>` tag is a robust fallback.
**Prevention:** Added a strict CSP `<meta>` tag to `index.html` allowing only 'self' and specific APIs (The-Odds-API), while blocking object-src and limiting script-src.

## 2025-02-12 - Flawed Input Sanitization Helper
**Vulnerability:** The `escapeHtml` and `escapeCSV` helper functions relied on `typeof unsafe !== 'string'` to bypass processing. This allowed non-string objects (e.g., those with custom `toString` methods) or unexpected types to bypass sanitization, potentially leading to XSS or CSV Injection if such data entered the system.
**Learning:** Type checks like `typeof` are insufficient for sanitization guards because template literals and string concatenation implicitly call `toString()`.
**Prevention:** Always explicitly cast input to string (e.g., `String(input)`) before sanitizing, or handle `null`/`undefined` explicitly and default to empty string.

## 2025-02-13 - Missing DoS Protection on Inputs
**Vulnerability:** The application accepted unlimited length input for API keys and allowed uploading arbitrarily large files for private keys, which could crash the browser (DoS) by filling memory when read via `FileReader`.
**Learning:** Client-side file processing logic often overlooks size limits because it assumes "trust" in the user, but large files can accidentally or maliciously freeze the UI. Similarly, text inputs without `maxLength` can accept megabytes of pasted text.
**Prevention:** Always add `maxLength` to text inputs. Always check `file.size` before calling `reader.readAsText()` or uploading.

## 2025-02-19 - Insecure Proxy SSL Configuration
**Vulnerability:** The Vite proxy was configured with `secure: false` for all connections, including the production Kalshi API. This disabled SSL certificate verification, allowing Man-in-the-Middle (MITM) attacks to intercept API keys and signed requests.
**Learning:** Development tools often default to permissive security (like ignoring self-signed certs) for ease of use, but these configurations can expose users if the same config is used for production targets.
**Prevention:** Conditionally enable `secure: false` only for `localhost` or specific dev environments. Default to `secure: true` for all other targets.

## 2025-02-23 - Insecure Session Persistence
**Vulnerability:** Users had no way to disconnect their wallet or clear private keys from memory/sessionStorage without closing the browser tab. This increases the risk of unauthorized access if a user steps away from an active session.
**Learning:** "Connect Wallet" flows often neglect the "Disconnect" state, assuming users will just close the tab. However, long-running dashboards are often left open, making explicit session termination critical for shared or public environments.
**Prevention:** Always implement an explicit "Disconnect" or "Logout" action that clears sensitive state and storage.
