use std::collections::HashMap;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct Position {
    pub ticker: String,
    pub quantity: u32,
    pub entry_price: u32,
    pub entry_cost_cents: u32, // includes fees
}

pub struct PositionTracker {
    positions: HashMap<String, Position>,
}

impl Default for PositionTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl PositionTracker {
    pub fn new() -> Self {
        Self {
            positions: HashMap::new(),
        }
    }

    pub fn has_position(&self, ticker: &str) -> bool {
        self.positions.contains_key(ticker)
    }

    pub fn record_entry(
        &mut self,
        ticker: String,
        quantity: u32,
        entry_price: u32,
        entry_cost_cents: u32,
    ) {
        self.positions.insert(
            ticker.clone(),
            Position {
                ticker,
                quantity,
                entry_price,
                entry_cost_cents,
            },
        );
    }

    #[allow(dead_code)]
    pub fn record_exit(&mut self, ticker: &str) -> Option<Position> {
        self.positions.remove(ticker)
    }

    #[allow(dead_code)]
    pub fn get(&self, ticker: &str) -> Option<&Position> {
        self.positions.get(ticker)
    }

    #[allow(dead_code)]
    pub fn all_positions(&self) -> Vec<&Position> {
        self.positions.values().collect()
    }

    #[allow(dead_code)]
    pub fn count(&self) -> usize {
        self.positions.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_tracker_is_empty() {
        let tracker = PositionTracker::new();
        assert_eq!(tracker.count(), 0);
        assert!(!tracker.has_position("TEST-TICKER"));
    }

    #[test]
    fn test_record_and_retrieve_position() {
        let mut tracker = PositionTracker::new();
        tracker.record_entry("TEST-TICKER".to_string(), 10, 50, 520);

        assert!(tracker.has_position("TEST-TICKER"));
        assert_eq!(tracker.count(), 1);

        let pos = tracker.get("TEST-TICKER").unwrap();
        assert_eq!(pos.ticker, "TEST-TICKER");
        assert_eq!(pos.quantity, 10);
        assert_eq!(pos.entry_price, 50);
        assert_eq!(pos.entry_cost_cents, 520);
    }

    #[test]
    fn test_exit_removes_position() {
        let mut tracker = PositionTracker::new();
        tracker.record_entry("TEST-TICKER".to_string(), 10, 50, 520);

        let exited = tracker.record_exit("TEST-TICKER");
        assert!(exited.is_some());
        assert_eq!(exited.unwrap().quantity, 10);

        assert!(!tracker.has_position("TEST-TICKER"));
        assert_eq!(tracker.count(), 0);
    }

    #[test]
    fn test_exit_nonexistent_returns_none() {
        let mut tracker = PositionTracker::new();
        let result = tracker.record_exit("NONEXISTENT");
        assert!(result.is_none());
    }

    #[test]
    fn test_multiple_positions() {
        let mut tracker = PositionTracker::new();
        tracker.record_entry("TICKER-1".to_string(), 5, 40, 210);
        tracker.record_entry("TICKER-2".to_string(), 8, 60, 490);

        assert_eq!(tracker.count(), 2);
        assert!(tracker.has_position("TICKER-1"));
        assert!(tracker.has_position("TICKER-2"));

        let all = tracker.all_positions();
        assert_eq!(all.len(), 2);
    }
}
