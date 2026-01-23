# BERNIE'S LOG - THE GRUDGE BOOK

## 2026-01-18 - [The Headache] Zombie Utility File
**Observation:** `kalshiMatching.js` existed solely to export `SPORT_MAPPING`, while also containing dead code (`findKalshiMatch`) that duplicated logic in `marketIndexing.js`.
**Lesson:** If a file only exports constants used by another "new" system, move the constants and delete the file. Don't leave ghosts haunting the codebase.

## 2026-01-24 - [The Headache] Heavy Crypto Library
**Observation:** `node-forge` (400KB+) was imported just to sign one API request payload, something `window.crypto.subtle` does natively in 3 lines of code.
**Lesson:** Never npm install for something the browser can do for free. Native APIs are forever; libraries are technical debt.
