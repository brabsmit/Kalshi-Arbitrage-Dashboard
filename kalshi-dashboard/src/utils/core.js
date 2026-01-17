// src/utils/core.js

// ==========================================
// FORMATTERS & ESCAPING
// ==========================================

export const formatDuration = (ms) => {
    if (!ms) return '-';
    const s = Math.abs(ms / 1000).toFixed(1);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
};

export const formatMoney = (val) => val ? `$${(val / 100).toFixed(2)}` : '$0.00';

export const formatOrderDate = (ts) => !ts ? '-' : new Date(ts).toLocaleString('en-US', {
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
});

export const formatGameTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
};

// ==========================================
// MATH & STRATEGY
// ==========================================

export const americanToProbability = (odds) => {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
};

export const probabilityToAmericanOdds = (prob) => {
    if (prob <= 0 || prob >= 1) return 0;
    if (prob >= 0.5) {
        const odds = - (prob / (1 - prob)) * 100;
        return Math.round(odds);
    } else {
        const odds = ((1 - prob) / prob) * 100;
        return Math.round(odds);
    }
};

export const calculateStrategy = (market, marginPercent) => {
    if (!market.isMatchFound) return { smartBid: null, reason: "No Market", edge: -100, maxWillingToPay: 0 };

    const fairValue = market.fairValue;

    // STRATEGY FIX: Volatility padding has been removed.
    // Previous logic increased margin during high volatility, but this was backwards:
    // - High volatility in sports betting indicates breaking news, injury reports, lineup changes
    // - These create the BEST arbitrage opportunities (books update at different speeds)
    // - Increasing margin during volatility meant AVOIDING the highest-edge trades
    // - In sports betting, unlike financial markets, volatility = opportunity, not risk
    //
    // New approach: Use base margin only.

    const maxWillingToPay = Math.floor(fairValue * (1 - marginPercent / 100));
    const currentBestBid = market.bestBid || 0;
    const edge = fairValue - currentBestBid;

    let smartBid = currentBestBid + 1;
    let reason = "Beat Market";

    // Alpha Strategy: Crossing the Spread (with Fee Protection)
    // If the Best Ask is significantly below our fair value, we take liquidity immediately
    // instead of waiting as a maker. However, we must account for Kalshi taker fees.
    //
    // Kalshi Taker Fee: ~7% of payout = ceil(0.07 * qty * price * (1-price))
    // Example: Buying 10 contracts at 50¢ = ~$1.75 in fees = ~1.75¢ per contract
    //
    // STRATEGY FIX: Increased buffer from 0¢ to 3¢ to ensure profitability after fees.
    // - At 0¢ buffer: Many "profitable" trades became break-even or losers after fees
    // - At 3¢ buffer: Ensures minimum ~1-2¢ profit per contract after typical taker fees
    // - This aligns with stated strategy of "patient maker-side arbitrage"
    // - Only cross the spread when edge is CLEARLY profitable, not marginally so
    const TAKER_FEE_BUFFER = 3;

    // Check if we can buy immediately at a significant discount (after accounting for fees)
    if (market.bestAsk > 0 && market.bestAsk <= (maxWillingToPay - TAKER_FEE_BUFFER)) {
        smartBid = market.bestAsk;
        reason = "Take Ask";
    }

    if (smartBid > maxWillingToPay) {
        smartBid = maxWillingToPay;
        reason = "Max Limit";
    }

    if (smartBid > 99) smartBid = 99;

    return { smartBid, maxWillingToPay, edge, reason };
};

export const calculateKalshiFees = (priceCents, quantity) => {
    // Formula from Fee Schedule (Taker): fees = ceil(0.07 * count * price_dollar * (1 - price_dollar))
    if (quantity <= 0) return 0;
    const p = priceCents / 100;
    const rawFee = 0.07 * quantity * p * (1 - p);
    return Math.ceil(rawFee * 100);
};

// ==========================================
// CRYPTO
// ==========================================

let cachedKeyPem = null;
let cachedForgeKey = null;

export const signRequest = async (privateKeyPem, method, path, timestamp) => {
    try {
        const forge = window.forge;
        if (!forge) throw new Error("Forge library not loaded");

        // Simple cache to avoid parsing PEM on every request
        let privateKey;
        if (cachedKeyPem === privateKeyPem && cachedForgeKey) {
            privateKey = cachedForgeKey;
        } else {
            privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
            cachedKeyPem = privateKeyPem;
            cachedForgeKey = privateKey;
        }

        const md = forge.md.sha256.create();
        const cleanPath = path.split('?')[0];
        const message = `${timestamp}${method}${cleanPath}`;
        md.update(message, 'utf8');
        const pss = forge.pss.create({
            md: forge.md.sha256.create(),
            mgf: forge.mgf.mgf1.create(forge.md.sha256.create()),
            saltLength: 32
        });
        const signature = privateKey.sign(md, pss);
        return forge.util.encode64(signature);
    } catch (e) {
        console.error("Signing failed:", e);
        throw new Error("Failed to sign request. Check your private key.");
    }
};
