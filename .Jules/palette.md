## 2023-10-27 - Improving Accessibility for Icon-Only Buttons
**Learning:** Icon-only buttons (common in Modals) are frequently missed in accessibility audits. React components using `lucide-react` often lack accessible names unless explicitly added.
**Action:** Always check modal close buttons and toolbar icons for `aria-label` or `title`. Use `aria-label` for better screen reader support over `title`.

## 2025-12-13 - Modal Form Accessibility
**Learning:** Modal forms often use layout elements (div/span) as visual labels without programmatic association, leaving screen reader users lost in inputs.
**Action:** Always verify inputs in modals have `htmlFor` matching `id`, or use `aria-label` where visual labels are complex or separated.

## 2024-05-22 - Accessible Table Sorting
**Learning:** Table headers (`<th>`) with `onClick` handlers are not focusable or actionable via keyboard, excluding users who rely on keyboard navigation.
**Action:** Wrap sortable header content in a `<button>` inside the `<th>` and use `aria-sort` on the `<th>` to communicate state.

## 2025-02-18 - Clickable Table Rows
**Learning:** Attaching `onClick` to `<tr>` elements makes the entire row clickable for mouse users but completely inaccessible to keyboard users, as table rows are not natively focusable.
**Action:** Wrap the primary cell content in a `<button>` to provide a keyboard target and screen reader semantics (like `aria-expanded`), while preserving the row click behavior for mouse convenience.
