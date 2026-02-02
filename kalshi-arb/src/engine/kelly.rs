//! Kelly criterion position sizing for Kalshi binary options.

/// Compute Kelly-optimal contract quantity.
///
/// - `fair_value`: vig-free probability in cents (1–99)
/// - `entry_price`: price per contract in cents (1–99)
/// - `bankroll_cents`: available balance in cents
/// - `kelly_fraction`: scaling factor (e.g. 0.25 for quarter-Kelly)
///
/// Returns recommended quantity, minimum 1.
pub fn kelly_size(
    fair_value: u32,
    entry_price: u32,
    bankroll_cents: u64,
    kelly_fraction: f64,
) -> u32 {
    if entry_price == 0
        || entry_price >= 100
        || fair_value == 0
        || bankroll_cents == 0
        || kelly_fraction <= 0.0
    {
        return 1;
    }

    let p = fair_value as f64 / 100.0;
    let q = 1.0 - p;
    let b = (100.0 - entry_price as f64) / entry_price as f64;

    // f* = (b*p - q) / b
    let f_star = (b * p - q) / b;

    if f_star <= 0.0 {
        return 1;
    }

    let wager_cents = f_star * kelly_fraction * bankroll_cents as f64;
    let qty = (wager_cents / entry_price as f64).floor() as u32;

    qty.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strong_edge_large_bankroll() {
        // fair=70, entry=60 → p=0.70, b=(100-60)/60=0.667
        // f* = (0.667*0.70 - 0.30) / 0.667 = (0.467 - 0.30) / 0.667 = 0.2505
        // wager = 0.2505 * 0.25 * 100_000 = 6262 cents
        // qty = floor(6262 / 60) = 104
        let qty = kelly_size(70, 60, 100_000, 0.25);
        assert_eq!(qty, 104);
    }

    #[test]
    fn test_small_edge_returns_floor_of_1() {
        // fair=61, entry=60 → p=0.61, b=0.667
        // f* = (0.667*0.61 - 0.39) / 0.667 = (0.407 - 0.39) / 0.667 = 0.0255
        // wager = 0.0255 * 0.25 * 10_000 = 63.7 cents
        // qty = floor(63.7 / 60) = 1 (floor is 1, matches min)
        let qty = kelly_size(61, 60, 10_000, 0.25);
        assert_eq!(qty, 1);
    }

    #[test]
    fn test_negative_kelly_returns_floor_of_1() {
        // fair=55, entry=60 → p=0.55, b=0.667
        // f* = (0.667*0.55 - 0.45) / 0.667 = (0.367 - 0.45) / 0.667 = -0.1245 (negative)
        // Strategy thresholds already filtered, so return floor of 1.
        let qty = kelly_size(55, 60, 100_000, 0.25);
        assert_eq!(qty, 1);
    }

    #[test]
    fn test_half_kelly_doubles_quarter() {
        // Same setup as strong_edge but kelly_fraction=0.50
        // wager = 0.2505 * 0.50 * 100_000 = 12525 cents
        // qty = floor(12525 / 60) = 208
        let qty = kelly_size(70, 60, 100_000, 0.50);
        assert_eq!(qty, 208);
    }

    #[test]
    fn test_zero_bankroll_returns_1() {
        let qty = kelly_size(70, 60, 0, 0.25);
        assert_eq!(qty, 1);
    }

    #[test]
    fn test_boundary_prices() {
        // entry_price=1 (extreme underdog), fair=5
        // b = 99/1 = 99, p=0.05, q=0.95
        // f* = (99*0.05 - 0.95) / 99 = (4.95 - 0.95) / 99 = 0.04040
        // wager = 0.04040 * 0.25 * 50_000 = 505 cents
        // qty = floor(505 / 1) = 505
        let qty = kelly_size(5, 1, 50_000, 0.25);
        assert_eq!(qty, 505);
    }

    #[test]
    fn test_entry_price_99() {
        // entry_price=99 (heavy favorite), fair=99
        // b = 1/99 = 0.0101, p=0.99, q=0.01
        // f* = (0.0101*0.99 - 0.01) / 0.0101 = (0.01 - 0.01) / 0.0101 ≈ 0
        // Edge is zero → floor of 1
        let qty = kelly_size(99, 99, 100_000, 0.25);
        assert_eq!(qty, 1);
    }

    #[test]
    fn test_kelly_fraction_zero_returns_1() {
        // kelly_fraction=0 means don't use Kelly → always 1
        let qty = kelly_size(70, 60, 100_000, 0.0);
        assert_eq!(qty, 1);
    }
}
