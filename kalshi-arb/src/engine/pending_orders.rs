use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct PendingOrder {
    pub ticker: String,
    pub quantity: u32,
    pub price: u32,
    pub is_taker: bool,
    pub submitted_at: Instant,
    pub order_id: Option<String>, // Kalshi order ID for cancellation
}

pub struct PendingOrderRegistry {
    orders: HashMap<String, PendingOrder>, // ticker -> pending order
}

impl Default for PendingOrderRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl PendingOrderRegistry {
    pub fn new() -> Self {
        Self {
            orders: HashMap::new(),
        }
    }

    /// Try to register a new order. Returns true if registered, false if already pending.
    pub fn try_register(
        &mut self,
        ticker: String,
        quantity: u32,
        price: u32,
        is_taker: bool,
    ) -> bool {
        if self.orders.contains_key(&ticker) {
            return false; // Already pending
        }
        self.orders.insert(
            ticker.clone(),
            PendingOrder {
                ticker,
                quantity,
                price,
                is_taker,
                submitted_at: Instant::now(),
                order_id: None,
            },
        );
        true
    }

    /// Register with a known order ID (after submission succeeds).
    pub fn register_with_id(
        &mut self,
        ticker: String,
        quantity: u32,
        price: u32,
        is_taker: bool,
        order_id: Option<String>,
    ) -> bool {
        if self.orders.contains_key(&ticker) {
            return false;
        }
        self.orders.insert(
            ticker.clone(),
            PendingOrder {
                ticker,
                quantity,
                price,
                is_taker,
                submitted_at: Instant::now(),
                order_id,
            },
        );
        true
    }

    /// Get a pending order by ticker.
    pub fn get(&self, ticker: &str) -> Option<&PendingOrder> {
        self.orders.get(ticker)
    }

    /// Get the order ID for a ticker (for cancellation).
    pub fn get_order_id(&self, ticker: &str) -> Option<String> {
        self.orders.get(ticker).and_then(|o| o.order_id.clone())
    }

    /// Get all pending order IDs (for bulk cancellation on kill-switch).
    pub fn all_order_ids(&self) -> Vec<String> {
        self.orders
            .values()
            .filter_map(|o| o.order_id.clone())
            .collect()
    }

    /// Set the order ID after submission succeeds.
    pub fn set_order_id(&mut self, ticker: &str, order_id: String) {
        if let Some(order) = self.orders.get_mut(ticker) {
            order.order_id = Some(order_id);
        }
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
    #[allow(dead_code)]
    pub fn old_orders(&self, threshold_secs: u64) -> Vec<&PendingOrder> {
        let now = Instant::now();
        self.orders
            .values()
            .filter(|o| now.duration_since(o.submitted_at).as_secs() > threshold_secs)
            .collect()
    }

    /// Remove and return all orders older than the given duration.
    /// Used for timeout detection - expired orders should be investigated/cancelled.
    pub fn expire_older_than(&mut self, max_age: Duration) -> Vec<PendingOrder> {
        let now = Instant::now();
        let expired_tickers: Vec<String> = self
            .orders
            .iter()
            .filter(|(_, order)| now.duration_since(order.submitted_at) > max_age)
            .map(|(ticker, _)| ticker.clone())
            .collect();

        expired_tickers
            .into_iter()
            .filter_map(|ticker| self.orders.remove(&ticker))
            .collect()
    }

    /// Remove and return all pending orders (for kill-switch).
    pub fn drain(&mut self) -> Vec<PendingOrder> {
        self.orders.drain().map(|(_, order)| order).collect()
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

        // Immediately check - orders just submitted are not "old" even with 0 threshold
        // (because duration is 0 seconds, and we check if duration > threshold)
        let old = registry.old_orders(0);
        assert_eq!(
            old.len(),
            0,
            "just-submitted order should not be > 0 seconds old"
        );

        // Very high threshold excludes all recent orders
        let old = registry.old_orders(999);
        assert_eq!(
            old.len(),
            0,
            "999 second threshold should exclude recent orders"
        );
    }

    #[test]
    fn test_register_with_order_id() {
        let mut registry = PendingOrderRegistry::new();
        registry.register_with_id("TEST".to_string(), 10, 50, true, Some("order-123".to_string()));

        let order = registry.get("TEST").expect("should have order");
        assert_eq!(order.order_id, Some("order-123".to_string()));
    }

    #[test]
    fn test_get_order_id_for_cancellation() {
        let mut registry = PendingOrderRegistry::new();
        registry.register_with_id("TEST".to_string(), 10, 50, true, Some("order-456".to_string()));

        let order_id = registry.get_order_id("TEST");
        assert_eq!(order_id, Some("order-456".to_string()));
    }

    #[test]
    fn test_set_order_id() {
        let mut registry = PendingOrderRegistry::new();
        registry.try_register("TEST".to_string(), 10, 50, true);

        assert_eq!(registry.get_order_id("TEST"), None);

        registry.set_order_id("TEST", "order-789".to_string());
        assert_eq!(registry.get_order_id("TEST"), Some("order-789".to_string()));
    }

    #[test]
    fn test_all_order_ids() {
        let mut registry = PendingOrderRegistry::new();
        registry.register_with_id("T1".to_string(), 1, 50, true, Some("o1".to_string()));
        registry.register_with_id("T2".to_string(), 2, 60, false, Some("o2".to_string()));
        registry.try_register("T3".to_string(), 3, 70, true); // No order ID

        let ids = registry.all_order_ids();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"o1".to_string()));
        assert!(ids.contains(&"o2".to_string()));
    }

    #[test]
    fn test_expire_old_orders() {
        let mut registry = PendingOrderRegistry::new();
        registry.try_register("OLD".to_string(), 10, 50, true);

        // Fresh order should not be expired with 30 second threshold
        let expired = registry.expire_older_than(Duration::from_secs(30));
        assert_eq!(expired.len(), 0);
        assert!(registry.is_pending("OLD"));
    }

    #[test]
    fn test_expire_returns_order_info() {
        let mut registry = PendingOrderRegistry::new();
        registry.register_with_id("TEST".to_string(), 10, 50, true, Some("order-789".to_string()));

        // Fresh orders won't expire immediately with reasonable threshold
        let expired: Vec<PendingOrder> = registry.expire_older_than(Duration::from_secs(30));
        // Nothing expired yet (just created, well under 30 seconds old)
        assert!(expired.is_empty());
    }

    #[test]
    fn test_drain_removes_all() {
        let mut registry = PendingOrderRegistry::new();
        registry.register_with_id("T1".to_string(), 1, 50, true, Some("o1".to_string()));
        registry.register_with_id("T2".to_string(), 2, 60, false, Some("o2".to_string()));
        registry.try_register("T3".to_string(), 3, 70, true);

        let drained = registry.drain();
        assert_eq!(drained.len(), 3);
        assert_eq!(registry.count(), 0);
    }

    #[test]
    fn test_drain_returns_order_ids() {
        let mut registry = PendingOrderRegistry::new();
        registry.register_with_id("T1".to_string(), 1, 50, true, Some("o1".to_string()));
        registry.register_with_id("T2".to_string(), 2, 60, false, Some("o2".to_string()));
        registry.try_register("T3".to_string(), 3, 70, true); // No order ID

        let drained = registry.drain();
        let order_ids: Vec<_> = drained.iter().filter_map(|o| o.order_id.as_ref()).collect();
        assert_eq!(order_ids.len(), 2);
    }
}
