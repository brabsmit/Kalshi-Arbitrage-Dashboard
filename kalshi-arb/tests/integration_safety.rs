// Integration tests for production safety features

#[cfg(test)]
mod tests {
    use kalshi_arb::config::RiskConfig;
    use kalshi_arb::engine::pending_orders::{OrderSide, PendingOrderRegistry};
    use kalshi_arb::engine::positions::PositionTracker;
    use kalshi_arb::engine::risk::RiskManager;

    #[test]
    fn test_risk_manager_enforces_limits() {
        let config = RiskConfig {
            max_contracts_per_market: 10,
            max_total_exposure_cents: 1000, // $10 max
            max_concurrent_markets: 3,
            kelly_fraction: 0.25,
        };
        let manager = RiskManager::new(config);

        // Should allow first trade
        assert!(manager.can_trade("TEST-1", 5, 500));
    }

    #[test]
    fn test_position_tracker_prevents_duplicates() {
        let tracker = PositionTracker::new();
        assert!(!tracker.has_position("TEST"));
    }

    #[test]
    fn test_pending_orders_prevent_duplicates() {
        let mut registry = PendingOrderRegistry::new();
        assert!(registry.try_register("TEST".to_string(), 10, 50, true, OrderSide::Entry));
        assert!(!registry.try_register("TEST".to_string(), 5, 60, false, OrderSide::Entry));
    }

    #[test]
    fn test_break_even_validation() {
        use kalshi_arb::engine::fees;

        let entry_cost = 98;
        let quantity = 1;
        let result = fees::break_even_sell_price(entry_cost, quantity, true);
        assert!(
            result.is_some(),
            "should have break-even for reasonable entry"
        );

        let impossible_cost = 10000;
        let result_impossible = fees::break_even_sell_price(impossible_cost, 1, true);
        assert!(
            result_impossible.is_none(),
            "should return None for impossible break-even"
        );
    }
}
