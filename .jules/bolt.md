## 2026-01-18 - Split Context Consumers for Performance
**Learning:** React Context updates trigger re-renders in all consumers. If a component consumes a high-frequency context (like a 1s timer) but also renders expensive sub-trees that don't depend on that context, performance suffers due to unnecessary reconciliation.
**Action:** Split the component. Extract the expensive, static parts into a `React.memo` child component. Pass data as props. The parent consumes the context and re-renders, but the child bails out because its props are stable.

## 2026-01-25 - Single-Pass Statistics Calculation
**Learning:** Calculating statistics like Variance and Max Drawdown often tempts developers to use multiple array traversals (e.g., `map` then `reduce`, or building an array just to loop over it). This is inefficient (O(N) memory, multiple O(N) passes).
**Action:** Use Welford's algorithm or simple incremental accumulation to calculate sums, sum of squares, and min/max peaks in a single pass. This reduces memory allocation to O(1) and cuts execution time significantly (20x in this case).
