# Simulation Realism Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add probabilistic fill simulation to make simulated P&L closely match live trading results.

**Architecture:** Add a `FillSimulator` module that gates all entry/exit fills through configurable probability checks. Track missed/rejected orders in TUI state for validation.

**Tech Stack:** Rust, rand crate for RNG, existing tokio/ratatui stack.

---

## Task 1: Add rand dependency

**Files:**
- Modify: `kalshi-arb/Cargo.toml`

**Step 1: Add rand to dependencies**

Add `rand` crate with `std_rng` feature for seeded RNG:

```toml
rand = { version = "0.8", features = ["std_rng"] }
```

**Step 2: Verify it compiles**

Run: `cd kalshi-arb && cargo check`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add kalshi-arb/Cargo.toml
git commit -m "chore: add rand dependency for fill simulation"
```

---

## Task 2: Add SimulationRealismConfig to config.rs

**Files:**
- Modify: `kalshi-arb/src/config.rs:204-220`

**Step 1: Add the config struct after SimulationConfig**

After line 220 (end of `SimulationConfig` default impl), add:

```rust
#[derive(Debug, Deserialize, Clone)]
pub struct SimulationRealismConfig {
    #[serde(default = "default_realism_enabled")]
    pub enabled: bool,
    #[serde(default = "default_taker_fill_rate")]
    pub taker_fill_rate: f64,
    #[serde(default = "default_taker_slippage_mean")]
    pub taker_slippage_mean_cents: u32,
    #[serde(default = "default_taker_slippage_std")]
    pub taker_slippage_std_cents: u32,
    #[serde(default = "default_maker_fill_rate")]
    pub maker_fill_rate: f64,
    #[serde(default = "default_maker_require_through")]
    pub maker_require_price_through: bool,
    #[serde(default = "default_apply_latency")]
    pub apply_latency: bool,
    #[serde(default = "default_max_hold_seconds")]
    pub max_hold_seconds: u64,
    #[serde(default = "default_timeout_slippage")]
    pub timeout_exit_slippage_cents: u32,
}

fn default_realism_enabled() -> bool { true }
fn default_taker_fill_rate() -> f64 { 0.85 }
fn default_taker_slippage_mean() -> u32 { 1 }
fn default_taker_slippage_std() -> u32 { 1 }
fn default_maker_fill_rate() -> f64 { 0.45 }
fn default_maker_require_through() -> bool { true }
fn default_apply_latency() -> bool { true }
fn default_max_hold_seconds() -> u64 { 300 }
fn default_timeout_slippage() -> u32 { 2 }

impl Default for SimulationRealismConfig {
    fn default() -> Self {
        Self {
            enabled: default_realism_enabled(),
            taker_fill_rate: default_taker_fill_rate(),
            taker_slippage_mean_cents: default_taker_slippage_mean(),
            taker_slippage_std_cents: default_taker_slippage_std(),
            maker_fill_rate: default_maker_fill_rate(),
            maker_require_price_through: default_maker_require_through(),
            apply_latency: default_apply_latency(),
            max_hold_seconds: default_max_hold_seconds(),
            timeout_exit_slippage_cents: default_timeout_slippage(),
        }
    }
}
```

**Step 2: Add realism field to SimulationConfig**

Change `SimulationConfig` to include the nested realism config:

```rust
#[derive(Debug, Deserialize, Clone)]
pub struct SimulationConfig {
    pub latency_ms: u64,
    pub use_break_even_exit: bool,
    #[serde(default)]
    pub validate_fair_value: bool,
    #[serde(default)]
    pub realism: SimulationRealismConfig,
}
```

**Step 3: Verify it compiles**

Run: `cd kalshi-arb && cargo check`
Expected: Compiles successfully

**Step 4: Commit**

```bash
git add kalshi-arb/src/config.rs
git commit -m "feat: add SimulationRealismConfig for probabilistic fills"
```

---

## Task 3: Update config.toml with realism defaults

**Files:**
- Modify: `kalshi-arb/config.toml`

**Step 1: Add realism section under [simulation]**

Find the `[simulation]` section and add after it:

```toml
[simulation.realism]
enabled = true
taker_fill_rate = 0.85
taker_slippage_mean_cents = 1
taker_slippage_std_cents = 1
maker_fill_rate = 0.45
maker_require_price_through = true
apply_latency = true
max_hold_seconds = 300
timeout_exit_slippage_cents = 2
```

**Step 2: Verify config parses**

Run: `cd kalshi-arb && cargo test test_config_file_parses`
Expected: Test passes

**Step 3: Commit**

```bash
git add kalshi-arb/config.toml
git commit -m "config: add simulation realism parameters"
```

---

## Task 4: Add realism tracking fields to AppState

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs:27-71`

**Step 1: Add tracking fields to AppState**

Add these fields after `sim_total_slippage_cents` (line 53):

```rust
    pub sim_entries_attempted: u32,
    pub sim_entries_filled: u32,
    pub sim_entries_missed: u32,
    pub sim_entries_rejected: u32,
    pub sim_exits_attempted: u32,
    pub sim_exits_filled: u32,
    pub sim_timeout_exits: u32,
```

**Step 2: Initialize fields in AppState::new()**

Add to the `new()` function around line 162:

```rust
            sim_entries_attempted: 0,
            sim_entries_filled: 0,
            sim_entries_missed: 0,
            sim_entries_rejected: 0,
            sim_exits_attempted: 0,
            sim_exits_filled: 0,
            sim_timeout_exits: 0,
```

**Step 3: Verify it compiles**

Run: `cd kalshi-arb && cargo check`
Expected: Compiles successfully

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/state.rs
git commit -m "feat: add realism tracking fields to AppState"
```

---

## Task 5: Create FillSimulator module

**Files:**
- Create: `kalshi-arb/src/engine/fill_simulator.rs`
- Modify: `kalshi-arb/src/engine/mod.rs`

**Step 1: Create the fill_simulator.rs file**

```rust
//! Probabilistic fill simulation for realistic P&L estimation.

use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

use crate::config::SimulationRealismConfig;

/// Result of attempting to fill an order.
#[derive(Debug, Clone, PartialEq)]
pub enum FillResult {
    /// Order filled at the given price.
    Filled { price: u32 },
    /// Opportunity gone after latency delay.
    Missed,
    /// Random rejection (queue position, etc.).
    Rejected,
    /// For exits: not filled this tick, try again.
    Pending,
}

/// Simulates realistic order fills with configurable probabilities.
pub struct FillSimulator {
    config: SimulationRealismConfig,
    rng: StdRng,
}

impl FillSimulator {
    pub fn new(config: SimulationRealismConfig) -> Self {
        Self {
            config,
            rng: StdRng::from_entropy(),
        }
    }

    /// Check if realism simulation is enabled.
    pub fn is_enabled(&self) -> bool {
        self.config.enabled
    }

    /// Attempt a taker entry order.
    ///
    /// - `signal_price`: The ask price when the signal fired
    /// - `current_ask`: The current ask price after latency
    ///
    /// Returns `Filled` with slippage applied, `Missed` if price moved, or `Rejected`.
    pub fn try_taker_entry(&mut self, signal_price: u32, current_ask: u32) -> FillResult {
        if !self.config.enabled {
            return FillResult::Filled { price: signal_price };
        }

        // Check if opportunity is still there after latency
        if self.config.apply_latency && current_ask > signal_price {
            return FillResult::Missed;
        }

        // Roll fill probability
        if self.rng.gen::<f64>() > self.config.taker_fill_rate {
            return FillResult::Rejected;
        }

        // Apply slippage (normal distribution, clamped)
        let slippage = self.sample_slippage();
        let fill_price = (current_ask as i32 + slippage).max(1).min(99) as u32;

        // Clamp slippage to reasonable bounds [ask, ask+3]
        let fill_price = fill_price.min(current_ask + 3);

        FillResult::Filled { price: fill_price }
    }

    /// Attempt a maker entry order.
    ///
    /// - `signal_price`: The price we're posting at (bid+1)
    ///
    /// Returns `Filled` at signal price, or `Rejected` due to queue position.
    pub fn try_maker_entry(&mut self, signal_price: u32) -> FillResult {
        if !self.config.enabled {
            return FillResult::Filled { price: signal_price };
        }

        // Roll fill probability (lower than taker due to queue position)
        if self.rng.gen::<f64>() > self.config.maker_fill_rate {
            return FillResult::Rejected;
        }

        // Makers get their exact price (no slippage)
        FillResult::Filled { price: signal_price }
    }

    /// Attempt a maker exit order.
    ///
    /// - `sell_price`: Our limit sell price
    /// - `current_bid`: Current best bid
    ///
    /// Returns `Filled`, `Pending` (try again next tick), or `Rejected`.
    pub fn try_maker_exit(&mut self, sell_price: u32, current_bid: u32) -> FillResult {
        if !self.config.enabled {
            // Original behavior: fill if bid >= sell_price
            if current_bid >= sell_price {
                return FillResult::Filled { price: sell_price };
            }
            return FillResult::Pending;
        }

        // Check if price level is reached
        if self.config.maker_require_price_through {
            // Need bid > sell_price (strictly greater)
            if current_bid <= sell_price {
                return FillResult::Pending;
            }
        } else {
            // Original behavior: bid >= sell_price
            if current_bid < sell_price {
                return FillResult::Pending;
            }
        }

        // Roll fill probability
        if self.rng.gen::<f64>() > self.config.maker_fill_rate {
            return FillResult::Pending; // Try again next tick
        }

        FillResult::Filled { price: sell_price }
    }

    /// Force a taker exit (timeout scenario).
    ///
    /// - `current_bid`: Current best bid
    ///
    /// Returns `Filled` with adverse slippage applied.
    pub fn force_taker_exit(&mut self, current_bid: u32) -> FillResult {
        let slippage = self.config.timeout_exit_slippage_cents as i32;
        let fill_price = (current_bid as i32 - slippage).max(1) as u32;
        FillResult::Filled { price: fill_price }
    }

    /// Get max hold seconds for timeout check.
    pub fn max_hold_seconds(&self) -> u64 {
        self.config.max_hold_seconds
    }

    /// Sample slippage from a truncated normal distribution.
    fn sample_slippage(&mut self) -> i32 {
        let mean = self.config.taker_slippage_mean_cents as f64;
        let std = self.config.taker_slippage_std_cents as f64;

        if std == 0.0 {
            return mean as i32;
        }

        // Box-Muller transform for normal distribution
        let u1: f64 = self.rng.gen();
        let u2: f64 = self.rng.gen();
        let z = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos();
        let sample = mean + std * z;

        // Clamp to [0, mean + 3*std] to avoid negative or extreme slippage
        sample.max(0.0).min(mean + 3.0 * std) as i32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> SimulationRealismConfig {
        SimulationRealismConfig {
            enabled: true,
            taker_fill_rate: 0.85,
            taker_slippage_mean_cents: 1,
            taker_slippage_std_cents: 1,
            maker_fill_rate: 0.45,
            maker_require_price_through: true,
            apply_latency: true,
            max_hold_seconds: 300,
            timeout_exit_slippage_cents: 2,
        }
    }

    #[test]
    fn test_disabled_always_fills() {
        let mut config = test_config();
        config.enabled = false;
        let mut sim = FillSimulator::new(config);

        assert_eq!(sim.try_taker_entry(50, 50), FillResult::Filled { price: 50 });
        assert_eq!(sim.try_maker_entry(50), FillResult::Filled { price: 50 });
    }

    #[test]
    fn test_taker_missed_when_price_moved() {
        let config = test_config();
        let mut sim = FillSimulator::new(config);

        // Price moved from 50 to 55 during latency
        let result = sim.try_taker_entry(50, 55);
        assert_eq!(result, FillResult::Missed);
    }

    #[test]
    fn test_maker_exit_requires_price_through() {
        let config = test_config();
        let mut sim = FillSimulator::new(config);

        // Bid equals sell price - should be Pending with require_through=true
        let result = sim.try_maker_exit(50, 50);
        assert_eq!(result, FillResult::Pending);
    }

    #[test]
    fn test_force_taker_exit_applies_slippage() {
        let config = test_config();
        let mut sim = FillSimulator::new(config);

        // Force exit at bid=50 with 2c slippage
        let result = sim.force_taker_exit(50);
        assert_eq!(result, FillResult::Filled { price: 48 });
    }

    #[test]
    fn test_fill_rates_produce_rejections() {
        let mut config = test_config();
        config.maker_fill_rate = 0.0; // Always reject
        let mut sim = FillSimulator::new(config);

        let result = sim.try_maker_entry(50);
        assert_eq!(result, FillResult::Rejected);
    }
}
```

**Step 2: Export module from engine/mod.rs**

Add to `kalshi-arb/src/engine/mod.rs`:

```rust
pub mod fill_simulator;

pub use fill_simulator::{FillResult, FillSimulator};
```

**Step 3: Run tests**

Run: `cd kalshi-arb && cargo test fill_simulator`
Expected: All tests pass

**Step 4: Commit**

```bash
git add kalshi-arb/src/engine/fill_simulator.rs kalshi-arb/src/engine/mod.rs
git commit -m "feat: implement FillSimulator with probabilistic fills"
```

---

## Task 6: Integrate FillSimulator into entry logic (pipeline.rs)

**Files:**
- Modify: `kalshi-arb/src/pipeline.rs:1167-1212`

**Step 1: Add FillSimulator parameter to evaluate_market**

The `evaluate_market` function needs access to a `FillSimulator`. Since it's called from the main loop, you'll need to pass `&mut FillSimulator` or use interior mutability.

For simplicity, pass `Option<&mut FillSimulator>` - None in live mode, Some in sim mode.

Update the function signature and add the parameter threading from callers.

**Step 2: Gate sim entry through FillSimulator**

Replace the sim mode entry block (lines 1167-1212) with:

```rust
        if sim_mode {
            // Simulation mode: use fill simulator for realistic fills
            let signal_ask = ask;

            let ticker_owned = ticker.to_string();
            let fill_result = if let Some(ref mut fill_sim) = fill_simulator {
                if is_taker {
                    fill_sim.try_taker_entry(signal_ask, ask)
                } else {
                    fill_sim.try_maker_entry(fill_price)
                }
            } else {
                // No simulator - instant fill (legacy behavior)
                crate::engine::FillResult::Filled { price: fill_price }
            };

            state_tx.send_modify(|s| {
                s.sim_entries_attempted += 1;

                match fill_result {
                    crate::engine::FillResult::Filled { price: actual_price } => {
                        if s.sim_balance_cents < total_cost {
                            return;
                        }
                        if s.sim_positions.iter().any(|p| p.ticker == ticker_owned) {
                            return;
                        }

                        // Recalculate costs with actual fill price
                        let actual_entry_fee = crate::engine::fees::calculate_fee(actual_price, qty, is_taker);
                        let actual_total_cost = (qty * actual_price) as i64 + actual_entry_fee as i64;

                        // Recalculate sell target with actual entry
                        let actual_sell_target = if sim_config.use_break_even_exit {
                            let total_entry = (qty * actual_price) + actual_entry_fee;
                            match crate::engine::fees::break_even_sell_price(total_entry, qty, false) {
                                Some(price) => price,
                                None => return, // Can't find viable exit
                            }
                        } else {
                            fair
                        };

                        let slippage = actual_price as i32 - signal_ask as i32;

                        s.sim_balance_cents -= actual_total_cost;
                        s.sim_entries_filled += 1;
                        s.sim_positions.push(crate::tui::state::SimPosition {
                            ticker: ticker_owned.clone(),
                            quantity: qty,
                            entry_price: actual_price,
                            sell_price: actual_sell_target,
                            entry_fee: actual_entry_fee as u32,
                            filled_at: std::time::Instant::now(),
                            signal_ask,
                            trace: Some(trace.clone()),
                        });
                        s.push_trade(crate::tui::state::TradeRow {
                            time: chrono::Local::now().format("%H:%M:%S").to_string(),
                            action: "BUY".to_string(),
                            ticker: ticker_owned.clone(),
                            price: actual_price,
                            quantity: qty,
                            order_type: "SIM".to_string(),
                            pnl: None,
                            slippage: Some(slippage),
                            source: source.to_string(),
                            fair_value_basis: format_fair_value_basis(&trace),
                        });
                        s.push_log(
                            "TRADE",
                            format!(
                                "SIM BUY {}x {} @ {}c (ask was {}c, slip {:+}c), sell target {}c",
                                qty, ticker_owned, actual_price, signal_ask, slippage, actual_sell_target
                            ),
                        );
                        s.sim_total_slippage_cents += slippage as i64;
                    }
                    crate::engine::FillResult::Missed => {
                        s.sim_entries_missed += 1;
                        s.push_log(
                            "SIM",
                            format!("MISSED {} - price moved during latency", ticker_owned),
                        );
                    }
                    crate::engine::FillResult::Rejected => {
                        s.sim_entries_rejected += 1;
                        s.push_log(
                            "SIM",
                            format!("REJECTED {} - queue position / random rejection", ticker_owned),
                        );
                    }
                    crate::engine::FillResult::Pending => {
                        // Shouldn't happen for entries
                    }
                }
            });

            return EvalOutcome::Evaluated(row, None);
        }
```

**Step 3: Update callers to pass FillSimulator**

Thread `Option<&mut FillSimulator>` through `evaluate_market` calls in the pipeline functions.

**Step 4: Verify it compiles**

Run: `cd kalshi-arb && cargo check`
Expected: Compiles (may have warnings about unused)

**Step 5: Commit**

```bash
git add kalshi-arb/src/pipeline.rs
git commit -m "feat: integrate FillSimulator into entry logic"
```

---

## Task 7: Integrate FillSimulator into exit logic (main.rs)

**Files:**
- Modify: `kalshi-arb/src/main.rs:1600-1735`

**Step 1: Create shared FillSimulator for WS task**

In main.rs, before spawning the WS task, create a `FillSimulator` wrapped in `Arc<Mutex<>>`:

```rust
let fill_simulator = Arc::new(std::sync::Mutex::new(
    crate::engine::FillSimulator::new(config.simulation.realism.clone())
));
let fill_sim_ws = fill_simulator.clone();
```

**Step 2: Update exit logic in Snapshot handler**

Replace the instant fill check with FillSimulator:

```rust
if sim_mode_ws {
    let ticker = snap.market_ticker.clone();
    let mut fill_sim = fill_sim_ws.lock().unwrap();

    state_tx_ws.send_modify(|s| {
        let mut filled_indices = Vec::new();
        let mut pending_indices = Vec::new();

        for (i, pos) in s.sim_positions.iter().enumerate() {
            if pos.ticker == ticker {
                s.sim_exits_attempted += 1;

                // Check for timeout first
                let held_secs = pos.filled_at.elapsed().as_secs();
                let max_hold = fill_sim.max_hold_seconds();

                if max_hold > 0 && held_secs > max_hold {
                    // Force taker exit due to timeout
                    filled_indices.push((i, fill_sim.force_taker_exit(yes_bid), true));
                } else {
                    match fill_sim.try_maker_exit(pos.sell_price, yes_bid) {
                        crate::engine::FillResult::Filled { price } => {
                            filled_indices.push((i, crate::engine::FillResult::Filled { price }, false));
                        }
                        crate::engine::FillResult::Pending => {
                            pending_indices.push(i);
                        }
                        _ => {}
                    }
                }
            }
        }

        // Process fills in reverse order
        for (i, result, is_timeout) in filled_indices.into_iter().rev() {
            if let crate::engine::FillResult::Filled { price: exit_price } = result {
                let pos = s.sim_positions.remove(i);
                let exit_fee = calculate_fee(exit_price, pos.quantity, is_timeout) as i64;
                let exit_revenue = (pos.quantity * exit_price) as i64;
                let entry_cost = (pos.quantity * pos.entry_price) as i64 + pos.entry_fee as i64;
                let pnl = (exit_revenue - exit_fee) - entry_cost;

                s.sim_balance_cents += exit_revenue - exit_fee;
                s.sim_realized_pnl_cents += pnl;
                s.sim_total_trades += 1;
                s.sim_exits_filled += 1;
                if is_timeout {
                    s.sim_timeout_exits += 1;
                }
                if pnl > 0 {
                    s.sim_winning_trades += 1;
                }

                // ... existing trade logging ...
            }
        }
    });
}
```

**Step 3: Repeat for Delta handler**

Apply the same pattern to the Delta event handler.

**Step 4: Verify it compiles**

Run: `cd kalshi-arb && cargo check`
Expected: Compiles successfully

**Step 5: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat: integrate FillSimulator into exit logic with timeout support"
```

---

## Task 8: Update TUI to display realism metrics

**Files:**
- Modify: `kalshi-arb/src/tui/render.rs:187-228`

**Step 1: Extend sim stats display**

Update the sim_stats_spans section to show fill rates:

```rust
    let sim_stats_spans: Vec<Span> = if state.sim_mode {
        if state.sim_entries_attempted == 0 {
            vec![
                Span::styled(" | Entries: ", Style::default().fg(Color::DarkGray)),
                Span::styled("0", Style::default().fg(Color::DarkGray)),
            ]
        } else {
            let fill_rate = state.sim_entries_filled * 100 / state.sim_entries_attempted;
            let win_pct = if state.sim_total_trades > 0 {
                state.sim_winning_trades * 100 / state.sim_total_trades
            } else {
                0
            };
            let avg_slip = if state.sim_entries_filled > 0 {
                state.sim_total_slippage_cents as f64 / state.sim_entries_filled as f64
            } else {
                0.0
            };

            let fill_color = if fill_rate >= 70 {
                Color::Green
            } else if fill_rate >= 50 {
                Color::Yellow
            } else {
                Color::Red
            };

            let win_color = if win_pct > 55 {
                Color::Green
            } else if win_pct >= 50 {
                Color::Yellow
            } else {
                Color::Red
            };

            let slip_color = if avg_slip <= 0.5 {
                Color::Green
            } else {
                Color::Yellow
            };

            vec![
                Span::styled(" | Fill: ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    format!("{}%", fill_rate),
                    Style::default().fg(fill_color),
                ),
                Span::styled(
                    format!(" ({}/{})", state.sim_entries_filled, state.sim_entries_attempted),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(" | Win: ", Style::default().fg(Color::DarkGray)),
                Span::styled(format!("{}%", win_pct), Style::default().fg(win_color)),
                Span::styled(" | Slip: ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    format!("{:+.1}\u{00a2}", avg_slip),
                    Style::default().fg(slip_color),
                ),
            ]
        }
    } else {
        vec![]
    };
```

**Step 2: Verify it compiles**

Run: `cd kalshi-arb && cargo check`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add kalshi-arb/src/tui/render.rs
git commit -m "feat: display fill rate and realism metrics in TUI"
```

---

## Task 9: Run full test suite and manual verification

**Files:** None (verification only)

**Step 1: Run all tests**

Run: `cd kalshi-arb && cargo test`
Expected: All tests pass

**Step 2: Run clippy**

Run: `cd kalshi-arb && cargo clippy -- -D warnings`
Expected: No warnings

**Step 3: Manual test in simulation mode**

Run: `cd kalshi-arb && cargo run -- --simulate`
Expected:
- TUI shows "Fill: X%" metric
- Some entries should show as MISSED or REJECTED in logs
- Exits may take multiple ticks to fill

**Step 4: Commit any fixes**

If any issues found, fix and commit.

---

## Task 10: Build release executable

**Files:**
- Modify: `kalshi-arb/kalshi-arb.exe` (binary)

**Step 1: Build release**

Run: `cd kalshi-arb && cargo build --release --target x86_64-pc-windows-gnu`
Expected: Build succeeds

**Step 2: Copy executable**

Run: `cp kalshi-arb/target/x86_64-pc-windows-gnu/release/kalshi-arb.exe kalshi-arb/kalshi-arb.exe`

**Step 3: Final commit**

```bash
git add kalshi-arb/kalshi-arb.exe
git commit -m "build: update Windows executable with simulation realism"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add rand dependency | Cargo.toml |
| 2 | Add SimulationRealismConfig | config.rs |
| 3 | Update config.toml | config.toml |
| 4 | Add tracking fields to AppState | tui/state.rs |
| 5 | Create FillSimulator module | engine/fill_simulator.rs, engine/mod.rs |
| 6 | Integrate into entry logic | pipeline.rs |
| 7 | Integrate into exit logic | main.rs |
| 8 | Update TUI display | tui/render.rs |
| 9 | Test and verify | - |
| 10 | Build release | kalshi-arb.exe |
