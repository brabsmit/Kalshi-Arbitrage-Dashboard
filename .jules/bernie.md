# Bernie's Grudge Book

## 2024-05-22 - [The Imports]
**Observation:** `TEAM_ABBR` was imported into `App.jsx` but never used. The component just carried it around like a pet rock.
**Lesson:** If you import it, use it. If you don't use it, delete it. Dead imports are just noise.

## 2024-05-22 - [The Ticker Logic]
**Observation:** `isTickerExpired` function. 30 lines of code to check if a ticker is expired, but it was never called.
**Lesson:** Code that isn't run is liability. Delete it.

## 2024-05-22 - [The Alias]
**Observation:** `formatPortfolioDate` was just calling `formatOrderDate`.
**Lesson:** Don't create a new name for the same thing. Just call the thing.

## 2025-12-17 - [The Redundant Data]
**Observation:** `TEAM_ABBR` contained 85 entries that were identical to the default logic (`substring(0,3)`).
**Lesson:** Don't hardcode what you can calculate. Redundant data is just more places for bugs to hide.

## 2025-12-17 - [The Fuzzy Match]
**Observation:** `findKalshiMatch` had a "Strategy 2" that tried to fuzzy match teams based on first letters. It was clever, dangerous, and likely buggy for teams sharing initials.
**Lesson:** Dumb, exact matching is better than clever, wrong matching. If it doesn't match exactly, don't bet on it.

## 2025-05-27 - [The Legacy Probability]
**Observation:** `impliedProb` was calculated in `fetchLiveOdds` using a "reference bookmaker" for "Legacy support", but was never used in the UI and shadowed by `vigFreeProb` in logic.
**Lesson:** Legacy code is dead code. If it's not used *now*, delete it. Don't carry baggage.

## 2025-12-21 - [The Loading Charade]
**Observation:** `useForge` hook. We were using a React hook, a state variable, and a `useEffect` just to inject a `<script>` tag that the app *requires* to function.
**Lesson:** If a library is required, put it in `index.html`. Browsers are good at loading scripts. We don't need React to manage `<script>` tags for us.

## 2025-12-21 - [The Utils Drawer]
**Observation:** `escapeHtml` and `escapeCSV` were living in `src/utils/core.js` but were only used in `src/App.jsx` (specifically for `DataExportModal`).
**Lesson:** Code that changes together should stay together. If a utility function is only used by one component, put it near that component. "Global" utils are often just a junk drawer.
