//! Integration test for critical safety mechanisms.

use kalshi_arb::config::RiskConfig;
use kalshi_arb::engine::pending_orders::{OrderSide, PendingOrderRegistry};
use kalshi_arb::engine::positions::PositionTracker;
use kalshi_arb::engine::risk::RiskManager;
use kalshi_arb::engine::strategy::{evaluate_with_slippage, TradeAction};
use std::time::{Duration, Instant};

#[test]
fn test_full_safety_gate_flow() {
    // 1. Risk manager allows initial trade
    let risk_config = RiskConfig {
        max_contracts_per_market: 10,
        max_total_exposure_cents: 1000,
        max_concurrent_markets: 3,
        kelly_fraction: 0.25,
    };
    let risk_manager = RiskManager::new(risk_config);
    assert!(risk_manager.can_trade("TEST-1", 5, 500));

    // 2. Position tracker prevents duplicate
    let mut position_tracker = PositionTracker::new();
    position_tracker.record_entry("TEST-1".to_string(), 5, 50, 520, 55, Instant::now(), true);
    assert!(position_tracker.has_position("TEST-1"));

    // 3. Pending order registry prevents duplicate submission
    let mut pending_orders = PendingOrderRegistry::new();
    assert!(pending_orders.try_register("TEST-2".to_string(), 5, 60, true, OrderSide::Entry));
    assert!(!pending_orders.try_register("TEST-2".to_string(), 5, 60, true, OrderSide::Entry));

    // 4. Order ID tracking for cancellation
    pending_orders.set_order_id("TEST-2", OrderSide::Entry, "order-123".to_string());
    assert_eq!(pending_orders.get_order_id("TEST-2", OrderSide::Entry), Some("order-123".to_string()));

    // 5. Slippage buffer affects strategy
    // Edge of 5 with 3-cent buffer -> effective edge of 2 -> maker only
    let signal = evaluate_with_slippage(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100, 3);
    assert!(matches!(signal.action, TradeAction::MakerBuy { .. }));

    // 6. Order timeout expiration (immediate check won't expire fresh orders)
    let expired = pending_orders.expire_older_than(Duration::from_secs(30));
    assert!(expired.is_empty(), "fresh orders should not expire with 30s threshold");
}

#[test]
fn test_drain_returns_all_orders() {
    let mut registry = PendingOrderRegistry::new();
    registry.register_with_id("T1".to_string(), 1, 50, true, Some("o1".to_string()), OrderSide::Entry);
    registry.register_with_id("T2".to_string(), 2, 60, false, Some("o2".to_string()), OrderSide::Exit);
    registry.try_register("T3".to_string(), 3, 70, true, OrderSide::Entry); // No order ID

    let drained = registry.drain();
    assert_eq!(drained.len(), 3);
    assert_eq!(registry.count(), 0);

    let order_ids: Vec<_> = drained.iter().filter_map(|o| o.order_id.as_ref()).collect();
    assert_eq!(order_ids.len(), 2);
}

#[test]
fn test_all_order_ids_for_bulk_cancel() {
    let mut registry = PendingOrderRegistry::new();
    registry.register_with_id("T1".to_string(), 1, 50, true, Some("order-1".to_string()), OrderSide::Entry);
    registry.register_with_id("T2".to_string(), 2, 60, false, Some("order-2".to_string()), OrderSide::Exit);
    registry.try_register("T3".to_string(), 3, 70, true, OrderSide::Entry); // No order ID

    let order_ids = registry.all_order_ids();
    assert_eq!(order_ids.len(), 2);
    assert!(order_ids.contains(&"order-1".to_string()));
    assert!(order_ids.contains(&"order-2".to_string()));
}

#[test]
fn test_slippage_buffer_downgrades_taker_to_maker() {
    // Without slippage: edge 5 >= taker_threshold 5 -> TAKER
    let signal_no_slip = evaluate_with_slippage(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100, 0);
    assert_eq!(signal_no_slip.action, TradeAction::TakerBuy);

    // With 1-cent slippage: effective_edge 4 < taker_threshold 5 -> MAKER
    let signal_with_slip = evaluate_with_slippage(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100, 1);
    assert!(matches!(signal_with_slip.action, TradeAction::MakerBuy { .. }));
}

#[test]
fn test_slippage_buffer_can_skip_trade() {
    // Edge of 2, slippage of 2 -> effective edge 0 < maker_threshold 2 -> SKIP
    let signal = evaluate_with_slippage(62, 58, 60, 5, 2, 1, 100_000, 0.25, 100, 2);
    assert_eq!(signal.action, TradeAction::Skip);
}
