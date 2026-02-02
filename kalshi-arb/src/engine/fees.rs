/// Kalshi fee calculation using integer math to avoid floating-point errors.
///
/// Taker rate: 7% -> fee = ceil(7 * Q * P * (100-P) / 10_000)
/// Maker rate: 1.75% -> fee = ceil(175 * Q * P * (100-P) / 1_000_000)
pub fn calculate_fee(price_cents: u32, quantity: u32, is_taker: bool) -> u32 {
    if quantity == 0 || price_cents == 0 || price_cents >= 100 {
        return 0;
    }
    let p = price_cents as u64;
    let q = quantity as u64;
    let spread_factor = p * (100 - p);

    if is_taker {
        let numerator = 7 * q * spread_factor;
        let denominator = 10_000u64;
        numerator.div_ceil(denominator) as u32
    } else {
        let numerator = 175 * q * spread_factor;
        let denominator = 1_000_000u64;
        numerator.div_ceil(denominator) as u32
    }
}

/// Find minimum sell price to break even after exit fees.
/// Returns None if break-even is impossible (would require price > 99).
pub fn break_even_sell_price(
    total_entry_cost_cents: u32,
    quantity: u32,
    is_taker_exit: bool,
) -> Option<u32> {
    for price in 1..=99u32 {
        let fee = calculate_fee(price, quantity, is_taker_exit);
        let gross = price * quantity;
        if gross >= fee + total_entry_cost_cents {
            return Some(price);
        }
    }
    None // impossible to break even
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_taker_fee_at_50_cents() {
        // 7 * 10 * 50 * 50 / 10_000 = 175_000 / 10_000 = 17.5 -> ceil = 18
        assert_eq!(calculate_fee(50, 10, true), 18);
    }

    #[test]
    fn test_maker_fee_at_50_cents() {
        // 175 * 10 * 50 * 50 / 1_000_000 = 4.375 -> ceil = 5
        assert_eq!(calculate_fee(50, 10, false), 5);
    }

    #[test]
    fn test_fee_at_boundaries() {
        assert_eq!(calculate_fee(0, 10, true), 0);
        assert_eq!(calculate_fee(100, 10, true), 0);
        assert_eq!(calculate_fee(50, 0, true), 0);
    }

    #[test]
    fn test_single_contract_taker() {
        // 7 * 1 * 50 * 50 / 10_000 = 17_500 / 10_000 = 1.75 -> ceil = 2
        assert_eq!(calculate_fee(50, 1, true), 2);
    }

    #[test]
    fn test_break_even() {
        // Bought 1 contract at 50c, taker fee = 2c -> total cost = 52c
        let entry_cost = 50 + calculate_fee(50, 1, true); // 52
        let be = break_even_sell_price(entry_cost, 1, true).expect("should have break-even");
        // Verify break even is correct
        let exit_fee = calculate_fee(be, 1, true);
        assert!(be * 1 >= entry_cost + exit_fee);
    }

    #[test]
    fn test_break_even_maker_exit() {
        let entry_cost = 50 * 10 + calculate_fee(50, 10, true); // 518
        let be = break_even_sell_price(entry_cost, 10, false).expect("should have break-even");
        let exit_fee = calculate_fee(be, 10, false);
        let gross = be * 10;
        assert!(
            gross >= entry_cost + exit_fee,
            "break_even={be}, gross={gross}, entry={entry_cost}, exit_fee={exit_fee}"
        );
        if be > 1 {
            let prev_fee = calculate_fee(be - 1, 10, false);
            let prev_gross = (be - 1) * 10;
            assert!(
                prev_gross < entry_cost + prev_fee,
                "be-1 should not break even"
            );
        }
    }

    #[test]
    fn test_break_even_at_extremes() {
        let entry_cost = 5 + calculate_fee(5, 1, true);
        let be = break_even_sell_price(entry_cost, 1, false).expect("should have break-even");
        assert!(be <= 99, "should find break-even below 99");
        assert!(be >= 5, "break-even should be at least entry price");

        let entry_cost_95 = 95 + calculate_fee(95, 1, true);
        let be_95 = break_even_sell_price(entry_cost_95, 1, false).expect("should have break-even");
        assert!(be_95 <= 99);
    }

    #[test]
    fn test_impossible_break_even_returns_none() {
        // Entry at 98c with taker fee = 0 (boundary), total = 98
        // To break even: need sell price * qty >= 98 + exit_fee
        // At 99c: gross = 99, exit_fee (taker) = ceil(7*1*99*1/10000) = 1
        // Net = 99 - 1 = 98, barely breaks even
        // But at 99c with maker exit fee = 0, so should return Some

        // Create truly impossible scenario: very high entry cost
        let impossible_entry_cost = 10000; // $100 for 1 contract (impossible)
        let result = break_even_sell_price(impossible_entry_cost, 1, false);
        assert_eq!(
            result, None,
            "should return None when break-even impossible"
        );
    }

    #[test]
    fn test_break_even_some_when_possible() {
        let entry_cost = 50 + calculate_fee(50, 1, true); // 52
        let result = break_even_sell_price(entry_cost, 1, true);
        assert!(
            result.is_some(),
            "should return Some when break-even possible"
        );
        let be = result.unwrap();
        assert!(be > 50 && be <= 99);
    }

    #[test]
    fn test_round_trip_profitability() {
        let buy_price = 55u32;
        let qty = 10u32;
        let entry_fee = calculate_fee(buy_price, qty, true);
        let total_entry = buy_price * qty + entry_fee;

        let sell_price =
            break_even_sell_price(total_entry, qty, false).expect("should have break-even");
        let exit_fee = calculate_fee(sell_price, qty, false);
        let gross_exit = sell_price * qty;
        let net_exit = gross_exit - exit_fee;

        assert!(
            net_exit >= total_entry,
            "round trip should break even: net_exit={net_exit}, total_entry={total_entry}"
        );

        if sell_price > 1 {
            let worse_exit_fee = calculate_fee(sell_price - 1, qty, false);
            let worse_gross = (sell_price - 1) * qty;
            let worse_net = worse_gross - worse_exit_fee;
            assert!(
                worse_net < total_entry,
                "one cent below break-even should lose money"
            );
        }
    }
}
