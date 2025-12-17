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
