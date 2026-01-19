## 2026-01-18 - Split Context Consumers for Performance
**Learning:** React Context updates trigger re-renders in all consumers. If a component consumes a high-frequency context (like a 1s timer) but also renders expensive sub-trees that don't depend on that context, performance suffers due to unnecessary reconciliation.
**Action:** Split the component. Extract the expensive, static parts into a `React.memo` child component. Pass data as props. The parent consumes the context and re-renders, but the child bails out because its props are stable.
