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
