use super::fees::calculate_fee;

/// Result of strategy evaluation for a single market.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct StrategySignal {
    pub action: TradeAction,
    pub price: u32,
    pub edge: i32,
    pub net_profit_estimate: i32,
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
pub fn evaluate(
    fair_value: u32,
    best_bid: u32,
    best_ask: u32,
    taker_threshold: u8,
    maker_threshold: u8,
    min_edge_after_fees: u8,
) -> StrategySignal {
    if best_ask == 0 || fair_value == 0 {
        return StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge: 0,
            net_profit_estimate: 0,
        };
    }

    let edge = fair_value as i32 - best_ask as i32;

    if edge < maker_threshold as i32 {
        return StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge,
            net_profit_estimate: 0,
        };
    }

    // Calculate net profit for taker buy + maker sell at fair value
    let entry_fee_taker = calculate_fee(best_ask, 1, true) as i32;
    let exit_fee_maker = calculate_fee(fair_value, 1, false) as i32;
    let taker_profit = fair_value as i32 - best_ask as i32 - entry_fee_taker - exit_fee_maker;

    // Calculate net profit for maker buy at bid+1 + maker sell at fair value
    let maker_buy_price = best_bid.saturating_add(1).min(99);
    let entry_fee_maker = calculate_fee(maker_buy_price, 1, false) as i32;
    let maker_profit = fair_value as i32 - maker_buy_price as i32 - entry_fee_maker - exit_fee_maker;

    if edge >= taker_threshold as i32 && taker_profit >= min_edge_after_fees as i32 {
        StrategySignal {
            action: TradeAction::TakerBuy,
            price: best_ask,
            edge,
            net_profit_estimate: taker_profit,
        }
    } else if edge >= maker_threshold as i32 && maker_profit >= min_edge_after_fees as i32 {
        StrategySignal {
            action: TradeAction::MakerBuy { bid_price: maker_buy_price },
            price: maker_buy_price,
            edge,
            net_profit_estimate: maker_profit,
        }
    } else {
        StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge,
            net_profit_estimate: 0,
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
        let signal = evaluate(65, 58, 60, 5, 2, 1);
        assert_eq!(signal.action, TradeAction::TakerBuy);
        assert_eq!(signal.price, 60);
        assert_eq!(signal.edge, 5);
    }

    #[test]
    fn test_evaluate_maker_buy() {
        let signal = evaluate(63, 58, 60, 5, 2, 1);
        assert!(matches!(signal.action, TradeAction::MakerBuy { .. }));
    }

    #[test]
    fn test_evaluate_skip() {
        let signal = evaluate(61, 58, 60, 5, 2, 1);
        assert_eq!(signal.action, TradeAction::Skip);
    }
}
