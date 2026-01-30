# Arbbot Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix systematic failures in the Rust arbbot so the TUI displays accurate live data (balance, orderbook, markets, edges) without placing any orders.

**Architecture:** Disable all order placement. Wire up the Kalshi balance/positions REST calls and WS orderbook updates into the strategy engine so the TUI shows real-time, accurate market state. Migrate from deprecated cent-integer API fields to `*_dollars` string fields. Clean up logging to WARN/ERROR only.

**Tech Stack:** Rust, tokio, reqwest, tokio-tungstenite, ratatui, serde, the-odds-api.com v4

---

### Task 1: Migrate Kalshi Market types from deprecated cent fields to `*_dollars` strings

The Kalshi API deprecated `yes_bid`, `yes_ask`, `no_bid`, `no_ask` integer fields on Jan 15, 2026. They may return 0 or be absent. The replacement fields are `yes_bid_dollars`, `yes_ask_dollars`, `no_bid_dollars`, `no_ask_dollars` — fixed-point strings like `"0.5600"`.

**Files:**
- Modify: `kalshi-arb/src/kalshi/types.rs`

**Step 1: Update the `Market` struct to use dollar string fields**

Replace the four deprecated integer price fields with their `_dollars` string equivalents, and add a helper to parse them to cents (u32).

```rust
// In Market struct, replace:
//   pub yes_bid: u32,
//   pub yes_ask: u32,
//   pub no_bid: u32,
//   pub no_ask: u32,
// With:
    #[serde(default)]
    pub yes_bid_dollars: Option<String>,
    #[serde(default)]
    pub yes_ask_dollars: Option<String>,
    #[serde(default)]
    pub no_bid_dollars: Option<String>,
    #[serde(default)]
    pub no_ask_dollars: Option<String>,
```

Add a free function to parse the dollar strings into cents:

```rust
/// Parse Kalshi fixed-point dollar string ("0.5600") to cents (56).
/// Returns 0 if the string is missing or malformed.
pub fn dollars_to_cents(dollars: Option<&str>) -> u32 {
    let s = match dollars {
        Some(s) if !s.is_empty() => s,
        _ => return 0,
    };
    // Parse as f64 then convert to cents, rounding to nearest
    s.parse::<f64>()
        .map(|d| (d * 100.0).round() as u32)
        .unwrap_or(0)
}
```

**Step 2: Run `cargo build` to find all compilation errors**

Run: `cd kalshi-arb && cargo build 2>&1`
Expected: Errors in `main.rs` and `matcher.rs` where `m.yes_bid` etc. are accessed.

**Step 3: Update `main.rs` to use the new dollar fields**

In the market indexing loop (~line 93-100), replace direct field access with `dollars_to_cents()`:

```rust
let side_market = matcher::SideMarket {
    ticker: m.ticker.clone(),
    title: m.title.clone(),
    yes_bid: types::dollars_to_cents(m.yes_bid_dollars.as_deref()),
    yes_ask: types::dollars_to_cents(m.yes_ask_dollars.as_deref()),
    no_bid: types::dollars_to_cents(m.no_bid_dollars.as_deref()),
    no_ask: types::dollars_to_cents(m.no_ask_dollars.as_deref()),
};
```

Add `use kalshi::types;` to imports if not already present (it's used via `kalshi::types::CreateOrderRequest` already).

**Step 4: Run `cargo build` to verify compilation**

Run: `cd kalshi-arb && cargo build 2>&1`
Expected: Successful build.

**Step 5: Commit**

```
feat: migrate Kalshi market prices from deprecated cent fields to *_dollars strings
```

---

### Task 2: Fetch and display Kalshi balance at startup and periodically

The TUI always shows `$0.00` because `get_balance()` is never called. The balance endpoint returns `{ "balance": <cents>, "portfolio_value": <cents> }`.

**Files:**
- Modify: `kalshi-arb/src/kalshi/types.rs` (add `portfolio_value` field)
- Modify: `kalshi-arb/src/main.rs` (call get_balance, update state)

**Step 1: Add `portfolio_value` to `BalanceResponse`**

```rust
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct BalanceResponse {
    pub balance: i64,
    #[serde(default)]
    pub portfolio_value: i64,
}
```

**Step 2: Fetch balance at startup and update AppState**

In `main.rs`, after building the market index and before spawning tasks, fetch the balance:

```rust
// Fetch initial balance
match rest.get_balance().await {
    Ok(balance) => {
        state_tx.send_modify(|s| {
            s.balance_cents = balance;
        });
        tracing::warn!("balance: {} cents (${:.2})", balance, balance as f64 / 100.0);
    }
    Err(e) => {
        tracing::error!("failed to fetch balance: {:#}", e);
    }
}
```

Remove `#[allow(dead_code)]` from `get_balance()` in `rest.rs`.

**Step 3: Add periodic balance refresh to the odds polling loop**

Inside the engine loop (after the odds processing, before the sleep), add:

```rust
// Refresh balance each cycle
if let Ok(balance) = rest_for_engine.get_balance().await {
    state_tx_engine.send_modify(|s| {
        s.balance_cents = balance;
    });
}
```

This requires `rest_for_engine` to already be cloned into the spawned task (it is — `main.rs:145`).

**Step 4: Run `cargo build` to verify**

Run: `cd kalshi-arb && cargo build 2>&1`
Expected: Successful build, no dead_code warnings for get_balance.

**Step 5: Commit**

```
feat: fetch and display Kalshi balance in TUI header
```

---

### Task 3: Wire WS orderbook updates into the market index for live bid/ask

The WS task receives orderbook snapshots and deltas but only logs them to the TUI. The strategy engine uses stale REST prices from startup. Fix: maintain a live orderbook cache updated by WS events, and use it in the strategy loop.

**Files:**
- Modify: `kalshi-arb/src/main.rs`

**Step 1: Create a shared orderbook cache**

Before spawning tasks, create a thread-safe orderbook cache:

```rust
use std::sync::Mutex;

// Live orderbook: ticker -> (best_yes_bid, best_yes_ask, best_no_bid, best_no_ask)
let live_book: Arc<Mutex<HashMap<String, (u32, u32, u32, u32)>>> =
    Arc::new(Mutex::new(HashMap::new()));
```

**Step 2: Update the WS event processor to populate the cache**

In the Phase 4 WS event processor task, update the orderbook on snapshot and delta events:

For snapshots: extract the best bid/ask from the depth arrays.
```rust
KalshiWsEvent::Snapshot(snap) => {
    // Best yes bid = highest price with positive quantity
    let yes_bid = snap.yes.iter().filter(|l| l[1] > 0)
        .map(|l| l[0] as u32).max().unwrap_or(0);
    let yes_ask = snap.no.iter().filter(|l| l[1] > 0)
        .map(|l| l[0] as u32).max().unwrap_or(0);
    // ... store in live_book
}
```

Wait — Kalshi's orderbook snapshot format has `yes` and `no` arrays where each entry is `[price, quantity]`. The `yes` array represents buy orders for YES contracts. The best YES bid is the *highest* price in the `yes` array with quantity > 0. The best YES ask is `100 - best_no_bid` (since buying NO at price P is equivalent to selling YES at 100-P).

Actually, Kalshi's snapshot format: `yes` = array of [price, quantity] for YES side, `no` = array of [price, quantity] for NO side. Best yes bid = max price in `yes` with qty > 0. Best yes ask = 100 - max price in `no` with qty > 0.

But the simpler approach: just track the raw yes/no arrays and compute bid/ask when needed. For now, keep it simple:

```rust
KalshiWsEvent::Snapshot(snap) => {
    let yes_bid = snap.yes.iter()
        .filter(|l| l[1] > 0).map(|l| l[0] as u32).max().unwrap_or(0);
    let no_bid = snap.no.iter()
        .filter(|l| l[1] > 0).map(|l| l[0] as u32).max().unwrap_or(0);
    let yes_ask = if no_bid > 0 { 100 - no_bid } else { 0 };
    let no_ask = if yes_bid > 0 { 100 - yes_bid } else { 0 };

    if let Ok(mut book) = live_book_ws.lock() {
        book.insert(snap.market_ticker.clone(), (yes_bid, yes_ask, no_bid, no_ask));
    }
    // ... existing TUI log
}
```

For deltas: update is more complex (need full book state). Simpler approach for now: on delta, don't try to reconstruct — just log. The snapshots provide a complete picture and are sent periodically.

**Step 3: Use live orderbook data in the strategy loop**

In the odds polling loop, after matching a market, check the live orderbook cache for fresher prices:

```rust
// Override stale REST prices with live WS prices if available
let (bid, ask) = if let Ok(book) = live_book_engine.lock() {
    if let Some(&(yes_bid, yes_ask, _, _)) = book.get(&mkt.ticker) {
        if yes_ask > 0 { (yes_bid, yes_ask) } else { (mkt.best_bid, mkt.best_ask) }
    } else {
        (mkt.best_bid, mkt.best_ask)
    }
} else {
    (mkt.best_bid, mkt.best_ask)
};
```

Then pass `bid` and `ask` to `strategy::evaluate()` instead of `mkt.best_bid` / `mkt.best_ask`.

**Step 4: Clone the Arc for each task that needs it**

```rust
let live_book_ws = live_book.clone();
let live_book_engine = live_book.clone();
```

**Step 5: Run `cargo build` to verify**

Run: `cd kalshi-arb && cargo build 2>&1`
Expected: Successful build.

**Step 6: Commit**

```
feat: wire WS orderbook snapshots into live bid/ask cache for strategy
```

---

### Task 4: Remove all order placement logic

The user wants to validate data accuracy before enabling trading. Remove order execution from the engine loop — keep signal evaluation and TUI display, but don't call `create_order`.

**Files:**
- Modify: `kalshi-arb/src/main.rs`

**Step 1: Remove the order execution block**

In the engine loop, replace the order execution block (lines ~216-255) with a log:

```rust
// Signal evaluation only — no order placement
if signal.action != strategy::TradeAction::Skip {
    tracing::warn!(
        ticker = %mkt.ticker,
        action = %action_str,
        price = signal.price,
        edge = signal.edge,
        net = signal.net_profit_estimate,
        inverse = mkt.is_inverse,
        "signal detected (dry run)"
    );
}
```

Remove the `risk_mgr` since it's no longer used (or keep it for future use, but remove the `can_trade` / `record_buy` calls).

**Step 2: Remove unused imports**

Remove `RiskManager` from the imports in `main.rs` if no longer referenced. Remove `CreateOrderRequest` usage.

**Step 3: Run `cargo build` to verify**

Run: `cd kalshi-arb && cargo build 2>&1`
Expected: Successful build, possibly some dead_code warnings for risk module — that's fine.

**Step 4: Commit**

```
feat: disable order placement, signal-only dry run mode
```

---

### Task 5: Wire TUI pause/resume/quit commands to the engine

The `_cmd_rx` receiver is created but immediately dropped. The `_is_paused` flag can never change.

**Files:**
- Modify: `kalshi-arb/src/main.rs`

**Step 1: Pass `cmd_rx` into the engine task**

Change:
```rust
let (cmd_tx, _cmd_rx) = mpsc::channel::<tui::TuiCommand>(16);
```
To:
```rust
let (cmd_tx, mut cmd_rx) = mpsc::channel::<tui::TuiCommand>(16);
```

Move `cmd_rx` into the engine task and check it each loop iteration:

```rust
// At start of engine loop iteration, drain commands
while let Ok(cmd) = cmd_rx.try_recv() {
    match cmd {
        tui::TuiCommand::Pause => {
            is_paused = true;
            state_tx_engine.send_modify(|s| s.is_paused = true);
        }
        tui::TuiCommand::Resume => {
            is_paused = false;
            state_tx_engine.send_modify(|s| s.is_paused = false);
        }
        tui::TuiCommand::Quit => return,
    }
}
```

Rename `_is_paused` to `is_paused`.

**Step 2: Run `cargo build` to verify**

Run: `cd kalshi-arb && cargo build 2>&1`
Expected: Successful build.

**Step 3: Commit**

```
fix: wire TUI pause/resume/quit commands to engine loop
```

---

### Task 6: Clean up logging — WARN/ERROR only, remove noisy INFO logs

Replace all `tracing::info!` calls with `tracing::debug!` so they're hidden by default. Keep `tracing::warn!` for operational signals and `tracing::error!` for failures. Change the tracing filter from `info` to `warn`.

**Files:**
- Modify: `kalshi-arb/src/main.rs`
- Modify: `kalshi-arb/src/kalshi/ws.rs`

**Step 1: Change the tracing filter**

In `main.rs`, change:
```rust
.with_env_filter("kalshi_arb=info")
```
To:
```rust
.with_env_filter("kalshi_arb=warn")
```

**Step 2: Downgrade noisy info logs to debug throughout**

In `main.rs`:
- `tracing::info!(sport, count = ...)` "indexed Kalshi markets" -> `tracing::debug!`
- `tracing::info!(total = ...)` "market index built" -> `tracing::debug!`

In `kalshi/ws.rs`:
- `tracing::info!("kalshi WS connected")` -> `tracing::debug!`
- `tracing::info!(count = ...)` "subscribed to tickers" -> `tracing::debug!`
- `tracing::info!("kalshi WS received close frame")` -> `tracing::debug!`

In the WS event processor in `main.rs`:
- The INFO-level TUI log entries for snapshots/deltas: change `"INFO"` to `"DEBUG"` or remove the per-delta log entirely (it will spam the TUI log with thousands of entries). Keep connection status changes at WARN level.

```rust
KalshiWsEvent::Snapshot(snap) => {
    // Update live book (from Task 3) — no TUI log per snapshot
}
KalshiWsEvent::Delta(delta) => {
    // Update live book — no TUI log per delta
}
```

Keep Connected/Disconnected as WARN in the TUI log.

**Step 3: Run `cargo build` to verify**

Run: `cd kalshi-arb && cargo build 2>&1`
Expected: Successful build.

**Step 4: Commit**

```
chore: clean up logging to WARN/ERROR only, remove per-tick noise
```

---

### Task 7: Add all four sports to the market index

Only NBA is indexed. The config already lists `sports = ["basketball"]` but the spec and the rest of the code support all four.

**Files:**
- Modify: `kalshi-arb/src/main.rs` (expand `sport_series`)
- Modify: `kalshi-arb/config.toml` (add all sports)
- Modify: `kalshi-arb/src/feed/the_odds_api.rs` (verify sport key mapping)

**Step 1: Expand `sport_series` in `main.rs`**

Replace:
```rust
let sport_series = vec![
    ("basketball", "KXNBAGAME"),
];
```
With:
```rust
let sport_series = vec![
    ("basketball", "KXNBAGAME"),
    ("american-football", "KXNFLGAME"),
    ("baseball", "KXMLBGAME"),
    ("ice-hockey", "KXNHLGAME"),
];
```

**Step 2: Update `config.toml` sports list**

```toml
sports = ["basketball", "american-football", "baseball", "ice-hockey"]
```

**Step 3: Verify `the_odds_api.rs` sport key mapping covers all four**

Check `api_sport_key()` — it already handles all four:
- `"basketball"` -> `"basketball_nba"`
- `"american-football"` -> `"americanfootball_nfl"`
- `"baseball"` -> `"baseball_mlb"`
- `"ice-hockey"` -> `"icehockey_nhl"`

No changes needed there.

**Step 4: Run `cargo build` to verify**

Run: `cd kalshi-arb && cargo build 2>&1`
Expected: Successful build.

**Step 5: Commit**

```
feat: index all four sports (NBA, NFL, MLB, NHL) instead of NBA only
```

---

### Task 8: Fix the `is_away_market` ambiguity for multi-word city abbreviations

The `is_away_market` function returns `None` for tickers like `LAC` (Los Angeles Clippers) because `contains("LAC")` matches neither "Los Angeles Clippers" after normalization. The fallback assigns away/home by insertion order, which is arbitrary.

**Files:**
- Modify: `kalshi-arb/src/engine/matcher.rs`

**Step 1: Improve `is_away_market` to use normalized team names**

The winner code in the ticker (e.g., `LAC`, `WAS`, `GSW`) is a Kalshi-specific abbreviation. Instead of substring matching against full team names, normalize the winner code and compare against normalized team names. Also add a static map for known Kalshi abbreviations.

```rust
pub fn is_away_market(ticker: &str, away: &str, home: &str) -> Option<bool> {
    let parts: Vec<&str> = ticker.split('-').collect();
    if parts.len() < 3 {
        return None;
    }
    let winner_code = parts.last()?.to_uppercase();

    // Try: does the game-info segment end with the winner code preceded by
    // the other team's code? E.g., "26JAN19LACWAS" -> last 3 chars before
    // winner code tell us position. If winner code appears first in the
    // combined segment, it's the away team (listed first in ticker).
    if let Some(game_part) = parts.get(1) {
        let game_upper = game_part.to_uppercase();
        // Strip the date prefix (7 chars: YYMMMDD like "26JAN19")
        if game_upper.len() > 7 {
            let teams_part = &game_upper[7..]; // e.g., "LACWAS"
            if teams_part.starts_with(&winner_code) {
                return Some(true); // winner code is first = away team
            }
            if teams_part.ends_with(&winner_code) {
                return Some(false); // winner code is last = home team
            }
        }
    }

    // Fallback: substring match on full names
    let away_upper = away.to_uppercase();
    let home_upper = home.to_uppercase();
    let matches_away = away_upper.contains(&winner_code) || away_upper.starts_with(&winner_code);
    let matches_home = home_upper.contains(&winner_code) || home_upper.starts_with(&winner_code);

    if matches_away && !matches_home {
        Some(true)
    } else if matches_home && !matches_away {
        Some(false)
    } else {
        None
    }
}
```

The key insight: Kalshi tickers encode both team abbreviations in the middle segment (e.g., `KXNBAGAME-26JAN19LACWAS-LAC`). The teams part after the date is `LACWAS` — away team first (`LAC`), home team second (`WAS`). The winner code at the end (`LAC`) tells us which team this market is for. If the winner code matches the start of the teams segment, it's the away team; if it matches the end, it's the home team.

**Step 2: Update/add tests**

```rust
#[test]
fn test_is_away_market_from_ticker_segment() {
    // LAC appears first in "LACWAS" = away, winner code "LAC" = away market
    assert_eq!(
        is_away_market("KXNBAGAME-26JAN19LACWAS-LAC", "Los Angeles Clippers", "Washington Wizards"),
        Some(true),
    );
    // WAS appears second in "LACWAS" = home, winner code "WAS" = home market
    assert_eq!(
        is_away_market("KXNBAGAME-26JAN19LACWAS-WAS", "Los Angeles Clippers", "Washington Wizards"),
        Some(false),
    );
}
```

**Step 3: Run tests**

Run: `cd kalshi-arb && cargo test -- matcher 2>&1`
Expected: All matcher tests pass (update old test expectations if they conflict).

**Step 4: Commit**

```
fix: resolve is_away_market ambiguity using ticker team-code position
```

---

### Task 9: Remove dead `resting_orders_count` field and clean up dead code warnings

Kalshi removed `resting_orders_count` from the positions API on Nov 13, 2025. The field deserializes safely due to `#[serde(default)]` but is dead code.

**Files:**
- Modify: `kalshi-arb/src/kalshi/types.rs`

**Step 1: Remove the field**

Delete from `MarketPosition`:
```rust
    #[serde(default)]
    pub resting_orders_count: u32,
```

**Step 2: Run `cargo build`**

Run: `cd kalshi-arb && cargo build 2>&1`
Expected: Successful build.

**Step 3: Commit**

```
chore: remove deprecated resting_orders_count field
```

---

### Task 10: Run full build + test suite, verify TUI renders correctly

**Step 1: Run all tests**

Run: `cd kalshi-arb && cargo test 2>&1`
Expected: All tests pass.

**Step 2: Run clippy**

Run: `cd kalshi-arb && cargo clippy 2>&1`
Expected: No errors. Warnings about dead code in `risk.rs` and `fees.rs` are acceptable (they'll be used when trading is enabled).

**Step 3: Commit any final fixes**

```
chore: fix clippy warnings and finalize remediation
```

---

## Task Dependency Order

```
Task 1 (types migration) ──> Task 2 (balance) ──> Task 3 (WS orderbook)
                                                         │
Task 4 (remove orders) ────────────────────────────────> │
Task 5 (TUI commands) ─────────────────────────────────> │
Task 6 (logging cleanup) ──────────────────────────────> │
Task 7 (all sports) ───────────────────────────────────> │
Task 8 (away market fix) ──────────────────────────────> │
Task 9 (dead code cleanup) ────────────────────────────> │
                                                         v
                                                  Task 10 (verify)
```

Tasks 1-3 are sequential (each depends on the previous). Tasks 4-9 are independent and can be done in any order or in parallel. Task 10 is final verification after all others complete.

## Balance $0 Root Cause

The `$0.00` balance in the TUI is caused by **`get_balance()` never being called**. The `AppState.balance_cents` is initialized to `0` in `AppState::new()` and never updated. The `get_balance()` method exists in `rest.rs:84` but is marked `#[allow(dead_code)]`. Task 2 fixes this by calling it at startup and refreshing it each poll cycle.

Secondary concern: Kalshi deprecated cent-based market price fields on Jan 15, 2026. While the balance endpoint still returns cents, the `Market` struct's `yes_bid`/`yes_ask`/`no_bid`/`no_ask` fields may return 0 since the API now uses `*_dollars` string fields. Task 1 addresses this migration.
