## 2024-02-14 - Event Log Accessibility
**Learning:** Users often need to export logs for debugging but screen readers miss icon-only buttons without explicit labels.
**Action:** When adding utility actions like "Copy", always include `aria-label` and visual feedback (like a checkmark) to confirm the action occurred, especially for invisible actions like clipboard writes.
