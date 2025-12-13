## 2024-05-23 - Pure JS Crypto Bottleneck
**Learning:** The application uses `node-forge` (pure JS) for RSA-PSS signing. Benchmarking revealed this takes ~50ms per signature. The dashboard makes 4 sequential signatures every 5 seconds (portfolio fetch), causing ~200ms of main thread blocking.
**Action:** Replace `node-forge` with `window.crypto.subtle` (Web Crypto API) for signing, which is native and much faster (< 1ms), while keeping Forge for key parsing/wrapping if needed.
