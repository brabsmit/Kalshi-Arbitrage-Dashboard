# BERNIE'S LOG - THE GRUDGE BOOK

## 2026-01-18 - [The Headache] Zombie Utility File
**Observation:** `kalshiMatching.js` existed solely to export `SPORT_MAPPING`, while also containing dead code (`findKalshiMatch`) that duplicated logic in `marketIndexing.js`.
**Lesson:** If a file only exports constants used by another "new" system, move the constants and delete the file. Don't leave ghosts haunting the codebase.

## 2026-01-24 - [Math Doppelgangers]
**Observation:** `core.js` contained a quick-and-dirty `calculateKalshiFees` (floating point!) and `calculateBreakEvenPrice`, while `KalshiMath.js` offered a robust, BigInt-based implementation. `autoClose.js` was using the inferior version in a loop.
**Lesson:** Never let two implementations of money logic exist. The "simple" helper function always ends up costing you when rounding errors appear. Delete the duplicate, force the usage of the robust class.
