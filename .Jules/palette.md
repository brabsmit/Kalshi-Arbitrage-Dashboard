## 2026-01-02 - Infinite Spinner Empty State
**Learning:**
Users were confused by the "Scanning markets..." spinner when filtering for sports that had no active games (e.g., NFL in July). The interface implied an ongoing background process that would never complete, rather than a definitive "no results" state.

**Action:**
Implemented a `hasScanned` state to differentiate between the initial data fetch and subsequent empty states.
- **Before:** Infinite "Scanning..." spinner if `markets.length === 0`.
- **After:** "Scanning..." only on first load. If 0 markets are found after fetch, display a "No active markets found" state with a timestamp or "Next scan in..." indicator. This gives users confidence that the system is working but there is simply no data.

## 2025-05-21 - Accessible Log Actions
**Learning:**
Log containers often trap content that users need to extract for debugging, but selecting text within scrollable overflow regions is frustrating and error-prone.

**Action:**
Added a dedicated "Copy Logs" button to the `EventLog` header.
- **Micro-UX:** Uses `navigator.clipboard` for one-click action.
- **Feedback:** Visual state change (Copy -> Check icon) confirms success without blocking the UI.
- **A11y:** Explicit `aria-label` that updates to "Copied Logs" provides screen reader confirmation.
