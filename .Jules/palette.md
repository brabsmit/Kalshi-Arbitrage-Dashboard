## 2024-05-22 - Accessible Dropdown State
**Learning:** Custom React dropdowns (like filters) often lack `aria-expanded` and `aria-controls`, making them opaque to screen reader users who can't tell if the menu is open.
**Action:** Use `useId` to link triggers to content and explicitly toggle `aria-expanded` state on the trigger button.

## 2024-05-23 - Visual Feedback for Async Actions
**Learning:** Users can double-click actions like "Bid" if there is no immediate visual feedback, potentially causing duplicate orders or errors.
**Action:** Implement local loading states (spinners) on action buttons to indicate processing immediately upon click.

## 2024-05-24 - Modal Keyboard Interactions
**Learning:** Custom modals consistently lacked `Escape` key support and backdrop click dismissal, trapping keyboard users and frustrating mouse users.
**Action:** Implemented a reusable `useModalClose` hook to standardize dismissal behavior across all application modals without repetitive code.
## 2024-05-24 - File Input Affordance
**Learning:** Standard file inputs are visually passive. Wrapping them in a styled "drop zone" with hover states and iconography significantly increases confidence in the "upload credential" step.
**Action:** Always wrap `input[type="file"]` in a styled container that reacts to hover/focus-within, and provides clear iconographic feedback.
