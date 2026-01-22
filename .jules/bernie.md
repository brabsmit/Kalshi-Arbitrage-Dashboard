# BERNIE'S LOG - THE GRUDGE BOOK

## 2026-01-18 - [The Headache] Zombie Utility File
**Observation:** `kalshiMatching.js` existed solely to export `SPORT_MAPPING`, while also containing dead code (`findKalshiMatch`) that duplicated logic in `marketIndexing.js`.
**Lesson:** If a file only exports constants used by another "new" system, move the constants and delete the file. Don't leave ghosts haunting the codebase.

## 2026-01-24 - [The Crypto Bloat]
**Observation:** `node-forge` was imported just to sign RSA requests. It's a massive library. Browsers have had `window.crypto.subtle` for years.
**Lesson:** Never import a 500KB library for something the browser does natively. Use `crypto.subtle`.
