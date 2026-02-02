use crate::config::RiskConfig;
use std::collections::HashMap;

#[allow(dead_code)]
pub struct RiskManager {
    config: RiskConfig,
    positions: HashMap<String, u32>, // ticker -> contract count
}

#[allow(dead_code)]
impl RiskManager {
    pub fn new(config: RiskConfig) -> Self {
        Self {
            config,
            positions: HashMap::new(),
        }
    }

    /// Check if we can open a new position.
    pub fn can_trade(&self, ticker: &str, quantity: u32, cost_cents: u32) -> bool {
        let current = self.positions.get(ticker).copied().unwrap_or(0);
        if current + quantity > self.config.max_contracts_per_market {
            return false;
        }
        if self.positions.len() as u32 >= self.config.max_concurrent_markets
            && !self.positions.contains_key(ticker)
        {
            return false;
        }
        let total_exposure: u64 = self
            .positions
            .values()
            .map(|&q| q as u64 * 100)
            .sum::<u64>()
            + cost_cents as u64;
        if total_exposure > self.config.max_total_exposure_cents {
            return false;
        }
        true
    }

    pub fn record_buy(&mut self, ticker: &str, quantity: u32) {
        *self.positions.entry(ticker.to_string()).or_insert(0) += quantity;
    }

    #[allow(dead_code)]
    pub fn record_sell(&mut self, ticker: &str, quantity: u32) {
        if let Some(pos) = self.positions.get_mut(ticker) {
            *pos = pos.saturating_sub(quantity);
            if *pos == 0 {
                self.positions.remove(ticker);
            }
        }
    }

    #[allow(dead_code)]
    pub fn position_count(&self, ticker: &str) -> u32 {
        self.positions.get(ticker).copied().unwrap_or(0)
    }

    #[allow(dead_code)]
    pub fn total_markets(&self) -> usize {
        self.positions.len()
    }
}
