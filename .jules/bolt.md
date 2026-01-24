## 2026-01-18 - Split Context Consumers for Performance
**Learning:** React Context updates trigger re-renders in all consumers. If a component consumes a high-frequency context (like a 1s timer) but also renders expensive sub-trees that don't depend on that context, performance suffers due to unnecessary reconciliation.
**Action:** Split the component. Extract the expensive, static parts into a `React.memo` child component. Pass data as props. The parent consumes the context and re-renders, but the child bails out because its props are stable.

## 2026-01-24 - Pre-Compute Derived State for Lists
**Learning:** Calculating derived state (like regex parsing or complex formatting) inside a list item component causes repetitive execution on every render, even if the result is stable. This is expensive for large lists (e.g., market scanners).
**Action:** Move derived state calculation upstream to the data fetching or transformation layer. Store the result in the data object itself. This ensures the calculation happens O(N) times (once per item update) rather than O(N * Renders).
