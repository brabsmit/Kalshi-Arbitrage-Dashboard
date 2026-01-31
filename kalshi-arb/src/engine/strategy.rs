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
        - entry_fee_taker - exit_fee_maker_t;

    // Kelly-size for maker path
    let maker_buy_price = best_bid.saturating_add(1).min(99);
    let maker_qty = {
        let raw = super::kelly::kelly_size(fair_value, maker_buy_price, bankroll_cents, kelly_fraction);
        raw.min(max_contracts)
    };
    let entry_fee_maker = calculate_fee(maker_buy_price, maker_qty, false) as i32;
    let exit_fee_maker_m = calculate_fee(fair_value, maker_qty, false) as i32;
    let maker_profit = (fair_value as i32 - maker_buy_price as i32) * maker_qty as i32
        - entry_fee_maker - exit_fee_maker_m;

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
            action: TradeAction::MakerBuy { bid_price: maker_buy_price },
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
    (home_implied / total, away_implied / total, draw_implied / total)
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
        assert_eq!(fair_value_cents(0.0), 1);  // clamped
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
}
