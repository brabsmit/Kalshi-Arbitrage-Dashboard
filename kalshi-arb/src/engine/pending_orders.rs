use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct PendingOrder {
    pub ticker: String,
    pub quantity: u32,
    pub price: u32,
    pub is_taker: bool,
    pub submitted_at: Instant,
}

pub struct PendingOrderRegistry {
    orders: HashMap<String, PendingOrder>, // ticker -> pending order
}

impl PendingOrderRegistry {
    pub fn new() -> Self {
        Self {
            orders: HashMap::new(),
        }
    }

    /// Try to register a new order. Returns true if registered, false if already pending.
    pub fn try_register(&mut self, ticker: String, quantity: u32, price: u32, is_taker: bool) -> bool {
        if self.orders.contains_key(&ticker) {
            return false; // Already pending
        }
        self.orders.insert(ticker.clone(), PendingOrder {
            ticker,
            quantity,
            price,
            is_taker,
            submitted_at: Instant::now(),
        });
        true
    }

    /// Mark order as complete (filled or canceled)
    pub fn complete(&mut self, ticker: &str) -> Option<PendingOrder> {
        self.orders.remove(ticker)
    }

    /// Check if ticker has pending order
    pub fn is_pending(&self, ticker: &str) -> bool {
        self.orders.contains_key(ticker)
    }

    /// Get all pending orders older than threshold (for timeout detection)
    pub fn old_orders(&self, threshold_secs: u64) -> Vec<&PendingOrder> {
        let now = Instant::now();
        self.orders.values()
            .filter(|o| now.duration_since(o.submitted_at).as_secs() > threshold_secs)
            .collect()
    }

    pub fn count(&self) -> usize {
        self.orders.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_registry_is_empty() {
        let registry = PendingOrderRegistry::new();
        assert_eq!(registry.count(), 0);
        assert!(!registry.is_pending("TEST"));
    }

    #[test]
    fn test_register_new_order() {
        let mut registry = PendingOrderRegistry::new();
        let result = registry.try_register("TEST".to_string(), 10, 50, true);

        assert!(result, "should register new order");
        assert!(registry.is_pending("TEST"));
        assert_eq!(registry.count(), 1);
    }

    #[test]
    fn test_duplicate_registration_fails() {
        let mut registry = PendingOrderRegistry::new();
        registry.try_register("TEST".to_string(), 10, 50, true);

        let result = registry.try_register("TEST".to_string(), 5, 60, false);
        assert!(!result, "should reject duplicate registration");
        assert_eq!(registry.count(), 1);
    }

    #[test]
    fn test_complete_removes_order() {
        let mut registry = PendingOrderRegistry::new();
        registry.try_register("TEST".to_string(), 10, 50, true);

        let removed = registry.complete("TEST");
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().quantity, 10);
        assert!(!registry.is_pending("TEST"));
        assert_eq!(registry.count(), 0);
    }

    #[test]
    fn test_complete_nonexistent_returns_none() {
        let mut registry = PendingOrderRegistry::new();
        let result = registry.complete("NONEXISTENT");
        assert!(result.is_none());
    }

    #[test]
    fn test_old_orders_detection() {
        let mut registry = PendingOrderRegistry::new();
        registry.try_register("TEST".to_string(), 10, 50, true);

        // Immediately check - no old orders
        let old = registry.old_orders(0);
        assert_eq!(old.len(), 1, "0 second threshold should include all");

        let old = registry.old_orders(999);
        assert_eq!(old.len(), 0, "999 second threshold should exclude recent orders");
    }
}
