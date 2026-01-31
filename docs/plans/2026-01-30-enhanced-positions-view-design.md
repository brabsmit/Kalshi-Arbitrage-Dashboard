# Enhanced Open Positions View

## Summary

Expand the Open Positions table from 5 columns to 10, adding mark-to-market P&L, position age, best bid, edge, and side. All data already exists in memory; changes are plumbing and rendering only.

## Column Specification

| # | Header | Source | Calculation | Color | Width |
|---|--------|--------|-------------|-------|-------|
| 1 | `Ticker` | `sim_position.ticker` | Raw string | White | Flexible |
| 2 | `Side` | Hardcoded `YES` | Literal | Cyan | 4 |
| 3 | `Qty` | `sim_position.quantity` | Raw u32 | White | 5 |
| 4 | `Entry` | `sim_position.entry_price` | Format as `XXc` | White | 6 |
| 5 | `Bid` | `live_book[ticker].yes_bid` | Format as `XXc` | Yellow | 6 |
| 6 | `Sell @` | `sim_position.sell_price` | Format as `XXc` | White | 6 |
| 7 | `Edge` | `fair_value - current_yes_ask` | Signed cents | Green/Red | 6 |
| 8 | `Tgt` | Existing P&L | `(sell@ - entry) * qty - entry_fee` | Green/Red | 7 |
| 9 | `Mkt` | New mark-to-market | `(best_bid * qty - exit_fee) - (entry * qty + entry_fee)` | Green/Red | 7 |
| 10 | `Age` | `Instant::now() - filled_at` | Compact relative: `45s`, `2m`, `1h03m` | White | 6 |

### Grouping rationale

- **Identity**: Ticker, Side, Qty
- **Prices**: Entry, Bid, Sell @
- **Signal**: Edge (is the original opportunity still alive?)
- **Outcomes**: Tgt (theoretical at target), Mkt (realizable right now)
- **Time**: Age

### Narrow-screen column dropping

Drop order when terminal width is insufficient (least critical first):

1. Edge
2. Side
3. Age
4. Mkt

Remaining minimum set: Ticker, Qty, Entry, Bid, Sell @, Tgt.

## Data Flow

### Problem

`draw_positions()` receives `AppState` which contains `sim_positions` but not the live order book. The live book is a separate `Arc<Mutex<HashMap>>`.

### Solution

Add `live_book: HashMap<String, (u32, u32, u32, u32)>` to `AppState`. The existing 200ms display refresh loop already clones the live book — extend it to write into `state.live_book`.

For Edge, look up `fair_value` from `state.markets` (already in `MarketRow`) and `yes_ask` from `state.live_book`.

For Mkt P&L exit fees, reuse the existing `calculate_fee()` function.

No new API calls. No new dependencies. No new async tasks.

## File Changes

### `src/tui/state.rs`

- Add `live_book: HashMap<String, (u32, u32, u32, u32)>` field to `AppState`
- Initialize as empty `HashMap` in `Default` impl

### `src/main.rs`

- In the 200ms display refresh task, after patching `MarketRow` bid/ask, also set `state.live_book = snapshot.clone()`

### `src/tui/render.rs`

- Rewrite `draw_positions()`:
  - 10-column header: Ticker, Side, Qty, Entry, Bid, Sell @, Edge, Tgt, Mkt, Age
  - For each position row:
    - Look up `state.live_book.get(&ticker)` for `yes_bid` and `yes_ask`
    - Look up `state.markets.iter().find(|m| m.ticker == ticker)` for `fair_value`
    - Compute Edge: `fair_value as i32 - yes_ask as i32`
    - Compute Mkt P&L: `(yes_bid * qty) as i64 - calculate_fee(yes_bid, qty, false) as i64 - (entry * qty) as i64 - entry_fee as i64`
    - Format Age: `Instant::now() - filled_at` → compact relative string
  - Rename existing P&L header from `P&L` to `Tgt`
  - Responsive width: measure available width, apply drop order

### Age formatting

```
< 60s  → "{s}s"      (e.g., "45s")
< 60m  → "{m}m"      (e.g., "12m")
>= 60m → "{h}h{mm}m" (e.g., "2h03m")
```

## Future considerations

This design anticipates the upcoming interactive mode where the expanded positions view will support row selection and actions (cancel, sell at market). The Side column and Mkt P&L column provide the context needed for those decisions. No changes are needed now to support that future work — the column layout is already structured for it.
