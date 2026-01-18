/**
 * Utility class for calculating Trading Fees and Break-Even prices
 * based on the official Kalshi Fee Schedule.
 */
export default class KalshiMath {
    /**
     * Calculates the trading fee in CENTS using integer math to avoid floating point errors.
     * Formula: ceil(Rate * Quantity * Price * (1 - Price))
     *
     * Integer Math Implementation:
     * Fee = ceil( Rate * Q * (PriceCents/100) * ((100-PriceCents)/100) * 100 )
     * Fee = ceil( Rate * Q * PriceCents * (100-PriceCents) / 100 )
     *
     * Taker Rate: 0.07 (7%) -> 7 / 100
     * Taker Fee = ceil( (7 * Q * P * (100-P)) / 10000 )
     *
     * Maker Rate: 0.0175 (1.75%) -> 175 / 10000
     * Maker Fee = ceil( (175 * Q * P * (100-P)) / 1000000 )
     *
     * @param {number} priceCents - Contract price in cents (1-99)
     * @param {number} quantity - Number of contracts
     * @param {boolean} isTaker - True for aggressive (taker) orders, False for resting (maker)
     * @returns {number} Fee in cents
     */
    static calculateFee(priceCents, quantity, isTaker) {
        if (quantity <= 0) return 0;

        // Use BigInt to prevent overflow for large quantities, although unlikely with standard limits
        // 100-priceCents is the probability of the other side in cents (0-99)
        const p = BigInt(priceCents);
        const q = BigInt(quantity);
        const spreadFactor = p * (100n - p); // P * (1-P) scaled by 100*100 = 10000

        if (isTaker) {
            // Rate: 0.07 = 7/100
            // Formula: (7 * Q * SpreadFactor) / 10000
            const numerator = 7n * q * spreadFactor;
            const denominator = 10000n;

            // Integer division with ceiling
            // (num + den - 1) / den
            return Number((numerator + denominator - 1n) / denominator);
        } else {
            // Rate: 0.0175 = 175/10000
            // Formula: (175 * Q * SpreadFactor) / 1000000
            const numerator = 175n * q * spreadFactor;
            const denominator = 1000000n;

            return Number((numerator + denominator - 1n) / denominator);
        }
    }

    /**
     * Finds the minimum sell price to break even.
     * Strategy: Iterative check (cheapest to most expensive) to find first profitable price.
     * @param {number} totalEntryCostCents - Total money spent (Price * Q + EntryFees)
     * @param {number} quantity - Number of contracts held
     * @param {boolean} isTakerExit - Assumed execution type for the exit (default true for safety)
     * @returns {number} Minimum sell price in cents (1-100), or 100 if impossible.
     */
    static calculateBreakEvenSellPrice(totalEntryCostCents, quantity, isTakerExit = true) {
        // Search strictly from 1 cent to 99 cents
        for (let price = 1; price <= 99; price++) {
            const potentialFee = this.calculateFee(price, quantity, isTakerExit);
            const grossRevenue = price * quantity;
            const netRevenue = grossRevenue - potentialFee;

            if (netRevenue >= totalEntryCostCents) {
                return price;
            }
        }
        return 100; // Impossible to break even
    }
}
