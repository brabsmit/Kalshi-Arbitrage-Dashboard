# Palette's Journal

## 2024-05-22 - Accessibility Selector Ambiguity
**Learning:** `get_by_label` in Playwright can be ambiguous when a custom component has both a semantic `<label for="id">` and an internal element with `aria-label="Same Text"`.
**Action:** Use `get_by_role("role", name="Label")` to target the specific interactive element (e.g., `slider`) instead of relying on the generic label association.
