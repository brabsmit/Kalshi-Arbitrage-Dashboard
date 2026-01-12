# Palette's Journal

## 2024-05-22 - Accessibility in Single-File React Components
**Learning:** Large single-file components (like App.jsx) often hide accessibility issues because standard linters might miss context when components are defined inside other components.
**Action:** When auditing `App.jsx`, pay extra attention to helper components defined within the file and ensure they have proper ARIA attributes, especially icon-only buttons.

## 2024-05-22 - Visual Feedback for Invisible Actions
**Learning:** Actions like "Copy to Clipboard" or "Refresh Data" often lack visual feedback, leaving users unsure if the action succeeded.
**Action:** Always implement a temporary visual state change (e.g., checkmark icon, "Copied!" text) or a toast notification for these invisible actions.
