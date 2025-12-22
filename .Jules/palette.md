## 2024-05-22 - Accessible Dropdown State
**Learning:** Custom React dropdowns (like filters) often lack `aria-expanded` and `aria-controls`, making them opaque to screen reader users who can't tell if the menu is open.
**Action:** Use `useId` to link triggers to content and explicitly toggle `aria-expanded` state on the trigger button.

## 2024-05-23 - Visual Feedback for Async Actions
**Learning:** Users can double-click actions like "Bid" if there is no immediate visual feedback, potentially causing duplicate orders or errors.
**Action:** Implement local loading states (spinners) on action buttons to indicate processing immediately upon click.

## 2024-05-24 - Modal Accessibility Gaps
**Learning:** Custom modal implementations in this codebase consistently lack keyboard support (Escape to close) and click-outside dismissal, forcing users to navigate to the close button.
**Action:** Future modals should use a reusable wrapper with `useEffect` listeners for 'keydown' (Escape) and backdrop click handlers.
