# Bolt's Journal

## 2024-05-22 - Optimizing Time-Series Data Management
**Learning:** React state updates for time-series data often inadvertently trigger O(N) allocations via `filter` inside loops.
**Action:** Use sorted properties of time-series data to use `slice` (finding index via while/binary search) instead of `filter`. Avoid strict spread `[...arr]` before filtering; filter/slice first, then append.
