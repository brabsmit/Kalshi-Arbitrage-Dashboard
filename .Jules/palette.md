## 2026-01-02 - Infinite Spinner Empty State
**Learning:**
Users were confused by the "Scanning markets..." spinner when filtering for sports that had no active games (e.g., NFL in July). The interface implied an ongoing background process that would never complete, rather than a definitive "no results" state.

**Action:**
Implemented a `hasScanned` state to differentiate between the initial data fetch and subsequent empty states.
- **Before:** Infinite "Scanning..." spinner if `markets.length === 0`.
- **After:** "Scanning..." only on first load. If 0 markets are found after fetch, display a "No active markets found" state with a timestamp or "Next scan in..." indicator. This gives users confidence that the system is working but there is simply no data.

## 2026-05-20 - Copy Button Feedback Pattern
**Learning:**
Users expect immediate visual confirmation when copying text to clipboard. A simple "Copy" icon changing to a "Check" icon provides clear, accessible feedback without needing a toast notification for minor actions.

**Action:**
Established a standard pattern for copy buttons:
1. Use `lucide-react` icons (`Copy` -> `Check`).
2. Use a temporary state (`copied`) that resets after 2000ms.
3. Include `aria-label` describing the action.
4. Disable the button if there is no content to copy.
