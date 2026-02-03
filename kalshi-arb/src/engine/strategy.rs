use super::fees::calculate_fee;

/// Result of strategy evaluation for a single market.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct StrategySignal {
    pub action: TradeAction,
    pub price: u32,
    pub edge: i32,
    pub net_profit_estimate: i32,
    pub quantity: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TradeAction {
    TakerBuy,
    MakerBuy { bid_price: u32 },
    Skip,
}

/// Evaluate whether to trade a market.
///
/// `fair_value`: vig-free probability * 100 (cents)
/// `best_bid`: best bid on Kalshi orderbook (cents)
/// `best_ask`: best ask on Kalshi orderbook (cents)
#[allow(clippy::too_many_arguments)]
pub fn evaluate(
    fair_value: u32,
    best_bid: u32,
    best_ask: u32,
    taker_threshold: u8,
    maker_threshold: u8,
    min_edge_after_fees: u8,
    bankroll_cents: u64,
    kelly_fraction: f64,
    max_contracts: u32,
) -> StrategySignal {
    if best_ask == 0 || fair_value == 0 {
        return StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge: 0,
            net_profit_estimate: 0,
            quantity: 0,
        };
    }

    let edge = fair_value as i32 - best_ask as i32;

    if edge < maker_threshold as i32 {
        return StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge,
            net_profit_estimate: 0,
            quantity: 0,
        };
    }

    // Kelly-size for taker path
    let taker_qty = {
        let raw = super::kelly::kelly_size(fair_value, best_ask, bankroll_cents, kelly_fraction);
        raw.min(max_contracts)
    };
    let entry_fee_taker = calculate_fee(best_ask, taker_qty, true) as i32;
    let exit_fee_maker_t = calculate_fee(fair_value, taker_qty, false) as i32;
    let taker_profit = (fair_value as i32 - best_ask as i32) * taker_qty as i32
        - entry_fee_taker
        - exit_fee_maker_t;

    // Kelly-size for maker path
    let maker_buy_price = best_bid.saturating_add(1).min(99);
    let maker_qty = {
        let raw =
            super::kelly::kelly_size(fair_value, maker_buy_price, bankroll_cents, kelly_fraction);
        raw.min(max_contracts)
    };
    let entry_fee_maker = calculate_fee(maker_buy_price, maker_qty, false) as i32;
    let exit_fee_maker_m = calculate_fee(fair_value, maker_qty, false) as i32;
    let maker_profit = (fair_value as i32 - maker_buy_price as i32) * maker_qty as i32
        - entry_fee_maker
        - exit_fee_maker_m;

    if edge >= taker_threshold as i32 && taker_profit >= min_edge_after_fees as i32 {
        StrategySignal {
            action: TradeAction::TakerBuy,
            price: best_ask,
            edge,
            net_profit_estimate: taker_profit,
            quantity: taker_qty,
        }
    } else if edge >= maker_threshold as i32 && maker_profit >= min_edge_after_fees as i32 {
        StrategySignal {
            action: TradeAction::MakerBuy {
                bid_price: maker_buy_price,
            },
            price: maker_buy_price,
            edge,
            net_profit_estimate: maker_profit,
            quantity: maker_qty,
        }
    } else {
        StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge,
            net_profit_estimate: 0,
            quantity: 0,
        }
    }
}

/// Evaluate with slippage buffer applied to edge calculation.
/// slippage_buffer_cents is subtracted from the raw edge before threshold comparison.
#[allow(clippy::too_many_arguments)]
pub fn evaluate_with_slippage(
    fair_value: u32,
    best_bid: u32,
    best_ask: u32,
    taker_threshold: u8,
    maker_threshold: u8,
    min_edge_after_fees: u8,
    bankroll_cents: u64,
    kelly_fraction: f64,
    max_contracts: u32,
    slippage_buffer_cents: u8,
) -> StrategySignal {
    if best_ask == 0 || fair_value == 0 {
        return StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge: 0,
            net_profit_estimate: 0,
            quantity: 0,
        };
    }

    let raw_edge = fair_value as i32 - best_ask as i32;
    let effective_edge = raw_edge - slippage_buffer_cents as i32;

    if effective_edge < maker_threshold as i32 {
        return StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge: raw_edge,  // Report raw edge for display
            net_profit_estimate: 0,
            quantity: 0,
        };
    }

    // Kelly-size for taker path (using actual price, not buffered)
    let taker_qty = {
        let raw = super::kelly::kelly_size(fair_value, best_ask, bankroll_cents, kelly_fraction);
        raw.min(max_contracts)
    };
    let entry_fee_taker = calculate_fee(best_ask, taker_qty, true) as i32;
    let exit_fee_maker_t = calculate_fee(fair_value, taker_qty, false) as i32;
    let taker_profit = (fair_value as i32 - best_ask as i32) * taker_qty as i32
        - entry_fee_taker
        - exit_fee_maker_t
        - (slippage_buffer_cents as i32 * taker_qty as i32); // Deduct expected slippage

    // Kelly-size for maker path
    let maker_buy_price = best_bid.saturating_add(1).min(99);
    let maker_qty = {
        let raw =
            super::kelly::kelly_size(fair_value, maker_buy_price, bankroll_cents, kelly_fraction);
        raw.min(max_contracts)
    };
    let entry_fee_maker = calculate_fee(maker_buy_price, maker_qty, false) as i32;
    let exit_fee_maker_m = calculate_fee(fair_value, maker_qty, false) as i32;
    let maker_profit = (fair_value as i32 - maker_buy_price as i32) * maker_qty as i32
        - entry_fee_maker
        - exit_fee_maker_m; // Maker has less slippage risk

    if effective_edge >= taker_threshold as i32 && taker_profit >= min_edge_after_fees as i32 {
        StrategySignal {
            action: TradeAction::TakerBuy,
            price: best_ask,
            edge: raw_edge,
            net_profit_estimate: taker_profit,
            quantity: taker_qty,
        }
    } else if effective_edge >= maker_threshold as i32 && maker_profit >= min_edge_after_fees as i32 {
        StrategySignal {
            action: TradeAction::MakerBuy {
                bid_price: maker_buy_price,
            },
            price: maker_buy_price,
            edge: raw_edge,
            net_profit_estimate: maker_profit,
            quantity: maker_qty,
        }
    } else {
        StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge: raw_edge,
            net_profit_estimate: 0,
            quantity: 0,
        }
    }
}

/// Result of dual-side evaluation, includes which side to trade.
#[derive(Debug, Clone)]
pub struct DualSideSignal {
    pub signal: StrategySignal,
    pub side: &'static str, // "yes" or "no"
}

/// Evaluate both YES and NO sides, return the better opportunity.
#[allow(clippy::too_many_arguments)]
pub fn evaluate_best_side(
    fair_value: u32,
    yes_bid: u32,
    yes_ask: u32,
    no_bid: u32,
    no_ask: u32,
    taker_threshold: u8,
    maker_threshold: u8,
    min_edge_after_fees: u8,
    bankroll_cents: u64,
    kelly_fraction: f64,
    max_contracts: u32,
    slippage_buffer_cents: u8,
) -> DualSideSignal {
    // Evaluate YES side
    let yes_signal = evaluate_with_slippage(
        fair_value,
        yes_bid,
        yes_ask,
        taker_threshold,
        maker_threshold,
        min_edge_after_fees,
        bankroll_cents,
        kelly_fraction,
        max_contracts,
        slippage_buffer_cents,
    );

    // Evaluate NO side (fair value is complement)
    let no_fair_value = 100u32.saturating_sub(fair_value);
    let no_signal = evaluate_with_slippage(
        no_fair_value,
        no_bid,
        no_ask,
        taker_threshold,
        maker_threshold,
        min_edge_after_fees,
        bankroll_cents,
        kelly_fraction,
        max_contracts,
        slippage_buffer_cents,
    );

    // Pick the better side based on net profit (or edge if both skip)
    let yes_score = if yes_signal.action != TradeAction::Skip {
        yes_signal.net_profit_estimate
    } else {
        yes_signal.edge // Use edge for comparison when both skip
    };

    let no_score = if no_signal.action != TradeAction::Skip {
        no_signal.net_profit_estimate
    } else {
        no_signal.edge
    };

    if no_score > yes_score && no_signal.action != TradeAction::Skip {
        DualSideSignal {
            signal: no_signal,
            side: "no",
        }
    } else {
        DualSideSignal {
            signal: yes_signal,
            side: "yes",
        }
    }
}

/// Apply momentum gating to a strategy signal.
///
/// Downgrades actions based on momentum score:
/// - Score < maker_threshold: force SKIP (edge without momentum)
/// - Score >= maker_threshold but < taker_threshold: cap at MAKER
/// - Score >= taker_threshold: allow TAKER
///
/// Signals already at SKIP pass through unchanged.
pub fn momentum_gate(
    signal: StrategySignal,
    momentum_score: f64,
    maker_momentum_threshold: u8,
    taker_momentum_threshold: u8,
) -> StrategySignal {
    match signal.action {
        TradeAction::Skip => signal,
        TradeAction::TakerBuy => {
            if momentum_score < maker_momentum_threshold as f64 {
                StrategySignal {
                    action: TradeAction::Skip,
                    quantity: 0,
                    ..signal
                }
            } else if momentum_score < taker_momentum_threshold as f64 {
                // Downgrade taker to maker: use ask-1 since we don't have best_bid here.
                // net_profit_estimate is approximate for downgraded signals.
                let bid_price = signal.price.saturating_sub(1).max(1);
                StrategySignal {
                    action: TradeAction::MakerBuy { bid_price },
                    price: bid_price,
                    ..signal
                }
            } else {
                signal
            }
        }
        TradeAction::MakerBuy { .. } => {
            if momentum_score < maker_momentum_threshold as f64 {
                StrategySignal {
                    action: TradeAction::Skip,
                    quantity: 0,
                    ..signal
                }
            } else {
                signal
            }
        }
    }
}

/// Convert American odds to implied probability.
/// Positive odds (e.g., +150): prob = 100 / (odds + 100)
/// Negative odds (e.g., -150): prob = |odds| / (|odds| + 100)
pub fn american_to_probability(odds: f64) -> f64 {
    if odds > 0.0 {
        100.0 / (odds + 100.0)
    } else {
        let abs = odds.abs();
        abs / (abs + 100.0)
    }
}

/// Devig two-way odds to get fair probabilities.
/// Returns (home_fair_prob, away_fair_prob).
pub fn devig(home_odds: f64, away_odds: f64) -> (f64, f64) {
    let home_implied = american_to_probability(home_odds);
    let away_implied = american_to_probability(away_odds);
    let total = home_implied + away_implied;
    if total == 0.0 {
        return (0.5, 0.5);
    }
    (home_implied / total, away_implied / total)
}

/// Devig three-way odds (soccer: home/away/draw) to get fair probabilities.
/// Returns (home_fair_prob, away_fair_prob, draw_fair_prob).
pub fn devig_3way(home_odds: f64, away_odds: f64, draw_odds: f64) -> (f64, f64, f64) {
    let home_implied = american_to_probability(home_odds);
    let away_implied = american_to_probability(away_odds);
    let draw_implied = american_to_probability(draw_odds);
    let total = home_implied + away_implied + draw_implied;
    if total == 0.0 {
        return (1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0);
    }
    (
        home_implied / total,
        away_implied / total,
        draw_implied / total,
    )
}

/// Compute fair value in cents from devigged probability.
pub fn fair_value_cents(probability: f64) -> u32 {
    (probability * 100.0).round().clamp(1.0, 99.0) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_american_to_probability() {
        let prob = american_to_probability(-150.0);
        assert!((prob - 0.6).abs() < 0.001);

        let prob = american_to_probability(150.0);
        assert!((prob - 0.4).abs() < 0.001);
    }

    #[test]
    fn test_devig() {
        let (home, away) = devig(-150.0, 130.0);
        assert!((home + away - 1.0).abs() < 0.001);
        assert!(home > 0.5); // favorite
    }

    #[test]
    fn test_fair_value_cents() {
        assert_eq!(fair_value_cents(0.60), 60);
        assert_eq!(fair_value_cents(0.0), 1); // clamped
        assert_eq!(fair_value_cents(1.0), 99); // clamped
    }

    #[test]
    fn test_evaluate_taker_buy() {
        let signal = evaluate(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100);
        assert_eq!(signal.action, TradeAction::TakerBuy);
        assert_eq!(signal.price, 60);
        assert_eq!(signal.edge, 5);
        assert!(signal.quantity > 0);
    }

    #[test]
    fn test_evaluate_maker_buy() {
        let signal = evaluate(63, 58, 60, 5, 2, 1, 100_000, 0.25, 100);
        assert!(matches!(signal.action, TradeAction::MakerBuy { .. }));
    }

    #[test]
    fn test_evaluate_skip() {
        let signal = evaluate(61, 58, 60, 5, 2, 1, 100_000, 0.25, 100);
        assert_eq!(signal.action, TradeAction::Skip);
    }

    #[test]
    fn test_devig_3way() {
        // Soccer-style: home -120, away +250, draw +280
        let (home, away, draw) = devig_3way(-120.0, 250.0, 280.0);
        assert!((home + away + draw - 1.0).abs() < 0.001);
        assert!(home > away); // home is favorite
        assert!(home > draw);
    }

    #[test]
    fn test_devig_3way_even() {
        // Roughly equal odds
        let (home, away, draw) = devig_3way(200.0, 200.0, 200.0);
        assert!((home - away).abs() < 0.001);
        assert!((home - draw).abs() < 0.001);
        assert!((home + away + draw - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_momentum_gate_skip_below_maker_threshold() {
        // Edge qualifies for taker, but momentum is too low → SKIP
        let signal = evaluate(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100);
        assert_eq!(signal.action, TradeAction::TakerBuy);
        let gated = momentum_gate(signal, 30.0, 40, 75);
        assert_eq!(gated.action, TradeAction::Skip);
    }

    #[test]
    fn test_momentum_gate_maker_in_middle_range() {
        // Edge qualifies for taker, momentum is moderate → MAKER
        let signal = evaluate(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100);
        assert_eq!(signal.action, TradeAction::TakerBuy);
        let gated = momentum_gate(signal, 55.0, 40, 75);
        assert!(matches!(gated.action, TradeAction::MakerBuy { .. }));
    }

    #[test]
    fn test_momentum_gate_taker_above_threshold() {
        // Edge qualifies for taker, momentum is high → TAKER preserved
        let signal = evaluate(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100);
        assert_eq!(signal.action, TradeAction::TakerBuy);
        let gated = momentum_gate(signal, 80.0, 40, 75);
        assert_eq!(gated.action, TradeAction::TakerBuy);
    }

    #[test]
    fn test_momentum_gate_skip_stays_skip() {
        // Edge too low → SKIP regardless of momentum
        let signal = evaluate(61, 58, 60, 5, 2, 1, 100_000, 0.25, 100);
        assert_eq!(signal.action, TradeAction::Skip);
        let gated = momentum_gate(signal, 90.0, 40, 75);
        assert_eq!(gated.action, TradeAction::Skip);
    }

    #[test]
    fn test_momentum_gate_maker_downgraded_to_skip() {
        // Edge qualifies for maker only, momentum too low → SKIP
        let signal = evaluate(63, 58, 60, 5, 2, 1, 100_000, 0.25, 100);
        assert!(matches!(signal.action, TradeAction::MakerBuy { .. }));
        let gated = momentum_gate(signal, 20.0, 40, 75);
        assert_eq!(gated.action, TradeAction::Skip);
    }

    #[test]
    fn test_momentum_gate_maker_preserved() {
        // Edge qualifies for maker, momentum moderate → MAKER preserved
        let signal = evaluate(63, 58, 60, 5, 2, 1, 100_000, 0.25, 100);
        assert!(matches!(signal.action, TradeAction::MakerBuy { .. }));
        let gated = momentum_gate(signal, 50.0, 40, 75);
        assert!(matches!(gated.action, TradeAction::MakerBuy { .. }));
    }

    #[test]
    fn test_evaluate_with_slippage_buffer() {
        // Edge of 5 with 2-cent slippage buffer -> effective edge of 3
        // Should downgrade from taker (threshold 5) to maker (threshold 2)
        let signal = evaluate_with_slippage(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100, 2);
        assert!(matches!(signal.action, TradeAction::MakerBuy { .. }));
    }

    #[test]
    fn test_slippage_buffer_can_cause_skip() {
        // Edge of 3 with 2-cent slippage buffer -> effective edge of 1
        // Below maker threshold (2) -> SKIP
        let signal = evaluate_with_slippage(63, 58, 60, 5, 2, 1, 100_000, 0.25, 100, 2);
        assert_eq!(signal.action, TradeAction::Skip);
    }

    #[test]
    fn test_slippage_zero_same_as_evaluate() {
        // With 0 slippage buffer, should behave same as regular evaluate
        let signal_with = evaluate_with_slippage(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100, 0);
        let signal_without = evaluate(65, 58, 60, 5, 2, 1, 100_000, 0.25, 100);
        assert_eq!(signal_with.action, signal_without.action);
    }

    #[test]
    fn test_dual_side_prefers_profitable_no() {
        // YES edge -12, NO edge +10 → should return NO side
        // fair_value=55, yes_ask=67 → YES edge = 55-67 = -12
        // no_fair_value=45, no_ask=35 → NO edge = 45-35 = +10
        let dual = evaluate_best_side(55, 65, 67, 33, 35, 5, 2, 1, 100_000, 0.25, 100, 0);
        assert_eq!(dual.side, "no");
        assert!(dual.signal.action != TradeAction::Skip);
    }

    #[test]
    fn test_dual_side_prefers_yes_when_better() {
        // YES edge +5, NO edge +3 → should return YES side
        // fair_value=65, yes_ask=60 → YES edge = 65-60 = +5
        // no_fair_value=35, no_ask=40 → NO edge = 35-40 = -5
        let dual = evaluate_best_side(65, 58, 60, 38, 40, 5, 2, 1, 100_000, 0.25, 100, 0);
        assert_eq!(dual.side, "yes");
    }

    #[test]
    fn test_dual_side_both_skip_returns_yes() {
        // Both edges negative → should return YES side Skip
        // fair_value=50, yes_ask=52 → YES edge = -2
        // no_fair_value=50, no_ask=52 → NO edge = -2
        let dual = evaluate_best_side(50, 48, 52, 48, 52, 5, 2, 1, 100_000, 0.25, 100, 0);
        assert_eq!(dual.side, "yes");
        assert_eq!(dual.signal.action, TradeAction::Skip);
    }

    #[test]
    fn test_dual_side_no_side_only_tradeable() {
        // YES has poor edge, NO has good edge
        // fair_value=30, yes_ask=40 → YES edge = 30-40 = -10 (Skip)
        // no_fair_value=70, no_ask=60 → NO edge = 70-60 = +10 (Taker)
        let dual = evaluate_best_side(30, 38, 40, 58, 60, 5, 2, 1, 100_000, 0.25, 100, 0);
        assert_eq!(dual.side, "no");
        assert_eq!(dual.signal.action, TradeAction::TakerBuy);
    }

    #[test]
    fn test_dual_side_yes_side_only_tradeable() {
        // YES has good edge, NO has poor edge
        // fair_value=70, yes_ask=60 → YES edge = 70-60 = +10 (Taker)
        // no_fair_value=30, no_ask=40 → NO edge = 30-40 = -10 (Skip)
        let dual = evaluate_best_side(70, 58, 60, 38, 40, 5, 2, 1, 100_000, 0.25, 100, 0);
        assert_eq!(dual.side, "yes");
        assert_eq!(dual.signal.action, TradeAction::TakerBuy);
    }
}
