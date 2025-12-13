## 2023-10-27 - Improving Accessibility for Icon-Only Buttons
**Learning:** Icon-only buttons (common in Modals) are frequently missed in accessibility audits. React components using `lucide-react` often lack accessible names unless explicitly added.
**Action:** Always check modal close buttons and toolbar icons for `aria-label` or `title`. Use `aria-label` for better screen reader support over `title`.

## 2025-12-13 - Modal Form Accessibility
**Learning:** Modal forms often use layout elements (div/span) as visual labels without programmatic association, leaving screen reader users lost in inputs.
**Action:** Always verify inputs in modals have `htmlFor` matching `id`, or use `aria-label` where visual labels are complex or separated.
