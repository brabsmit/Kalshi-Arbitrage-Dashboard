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
        ((numerator + denominator - 1) / denominator) as u32
    } else {
        let numerator = 175 * q * spread_factor;
        let denominator = 1_000_000u64;
        ((numerator + denominator - 1) / denominator) as u32
    }
}

/// Find minimum sell price to break even after exit fees.
pub fn break_even_sell_price(total_entry_cost_cents: u32, quantity: u32, is_taker_exit: bool) -> u32 {
    for price in 1..=99u32 {
        let fee = calculate_fee(price, quantity, is_taker_exit);
        let gross = price * quantity;
        if gross >= fee + total_entry_cost_cents {
            return price;
        }
    }
    100 // impossible to break even
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
        let be = break_even_sell_price(entry_cost, 1, true);
        // Verify break even is correct
        let exit_fee = calculate_fee(be, 1, true);
        assert!(be * 1 >= entry_cost + exit_fee);
    }
}
