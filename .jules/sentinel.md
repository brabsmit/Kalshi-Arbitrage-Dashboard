# Sentinel's Journal

## 2025-02-19 - Dev Server Security Exposure
**Vulnerability:** The Vite development server configuration (`vite.config.js`) explicitly sets `host: true` and includes `allowedHosts` pointing to a public DDNS domain (`bryan-desktop.ddns.net`). This means the development server, along with its specific headers and potential HMR code, is intended to be exposed to the local network or internet.
**Learning:** Development configurations often bleed into "production-like" usage when developers expose their local dev servers for testing. Security headers in `vite.config.js` are therefore critical because they become the *de facto* production headers for these users, even though they are technically "dev-only".
**Prevention:** Always audit `vite.config.js` `server.headers` as if they were production headers, especially when `host: true` is enabled. Do not assume dev configurations are isolated to localhost.
