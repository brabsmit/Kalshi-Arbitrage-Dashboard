## 2023-10-27 - Improving Accessibility for Icon-Only Buttons
**Learning:** Icon-only buttons (common in Modals) are frequently missed in accessibility audits. React components using `lucide-react` often lack accessible names unless explicitly added.
**Action:** Always check modal close buttons and toolbar icons for `aria-label` or `title`. Use `aria-label` for better screen reader support over `title`.
