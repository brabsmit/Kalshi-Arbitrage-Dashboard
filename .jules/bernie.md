## 2026-01-24 - [The Forge Anvil]
**Observation:** We were loading a 300KB+ crypto library (`forge.min.js`) globally via a script tag just to sign API requests, despite modern browsers having native `window.crypto.subtle` support for years.
**Lesson:** Never import a crypto library for standard algorithms (RSA, SHA) in a browser environment. Use the Web Crypto API. It's faster, safer, and zero bytes.
