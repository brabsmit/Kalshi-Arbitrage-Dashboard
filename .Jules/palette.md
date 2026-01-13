## 2024-05-23 - Event Log Accessibility and Usability
**Learning:** The `role="log"` with `aria-live="polite"` is the standard pattern for real-time event logs, but it must be applied to the container of the log items. Also, adding a "Copy" feature to logs significantly improves the debugging experience for power users.
**Action:** Always include "Copy" functionality for any data-heavy logs or JSON outputs, and ensure `role="log"` is present for screen reader announcements.
