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
