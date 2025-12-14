
## 2024-05-23 - Stabilization of Monolithic State Updates
**Learning:** In a monolithic React component handling high-frequency data (WebSocket/Polling), re-creating object references for identical data causes massive re-render storms even with `React.memo` on children.
**Action:** Implemented deep equality checks and reused previous object references within the state update function (`setMarkets`) to prevent `React.memo` cache misses.
