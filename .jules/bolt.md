# Bolt's Journal

## 2024-05-22 - Optimizing Time-Series Data Management
**Learning:** React state updates for time-series data often inadvertently trigger O(N) allocations via `filter` inside loops.
**Action:** Use sorted properties of time-series data to use `slice` (finding index via while/binary search) instead of `filter`. Avoid strict spread `[...arr]` before filtering; filter/slice first, then append.
## 2025-01-30 - Unexpected Performance Win
**Learning:** Replaced multiple sequential `.filter` and `.reduce` chains with a single imperative `for...of` loop in `StatsBanner`. While often considered 'uglier' or less 'React-like', it reduced complexity from O(K*N) to O(N) and removed intermediate array allocations.
**Action:** When handling large lists (like trade history) inside `useMemo`, consider imperative loops if multiple derived stats are needed. It's faster and uses less memory than functional chains.

## 2025-01-30 - Dependency Discipline
**Learning:** Attempted to fix a linting error by upgrading `eslint-plugin-react` and modifying `package-lock.json`. This violated the 'Never do' boundary.
**Action:** Always check boundaries before modifying dependency files. If a linter complains about missing plugins in an old config, try to work around it or ask for permission, rather than silently upgrading dependencies.
