
## 2024-05-23 - Stabilization of Monolithic State Updates
**Learning:** In a monolithic React component handling high-frequency data (WebSocket/Polling), re-creating object references for identical data causes massive re-render storms even with `React.memo` on children.
**Action:** Implemented deep equality checks and reused previous object references within the state update function (`setMarkets`) to prevent `React.memo` cache misses.

## 2024-05-24 - Timer Coalescing for Latency Displays
**Learning:** Individual components managing their own high-frequency timers (e.g., `setInterval` for "time ago") scale poorly (O(N) overhead) and desynchronize updates.
**Action:** Use a single `TimeProvider` context that ticks once and distributes the current time to all consumers, ensuring synchronized updates and reduced timer overhead.
