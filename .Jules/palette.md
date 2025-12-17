## 2024-05-22 - Accessible Dropdown State
**Learning:** Custom React dropdowns (like filters) often lack `aria-expanded` and `aria-controls`, making them opaque to screen reader users who can't tell if the menu is open.
**Action:** Use `useId` to link triggers to content and explicitly toggle `aria-expanded` state on the trigger button.
