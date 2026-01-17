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

export const calculateVolatility = (history) => {
    if (!history || history.length < 2) return 0;
    let sum = 0;
    let sumSq = 0;
    const n = history.length;
    // Single pass O(N) loop to avoid array allocation and multiple traversals
    for (let i = 0; i < n; i++) {
        const v = history[i].v;
        sum += v;
        sumSq += v * v;
    }
    // Variance = (SumSq - (Sum*Sum)/N) / (N - 1)
    const variance = (sumSq - (sum * sum) / n) / (n - 1);
    return Math.sqrt(Math.max(0, variance));
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
    // New approach: Use base margin only. Volatility is now tracked for informational purposes
    // but does not affect position sizing or bid prices.
    const volatility = market.volatility || 0;
    const effectiveMargin = marginPercent; // Removed volatility padding: was marginPercent + (volatility * 0.25)

    const maxWillingToPay = Math.floor(fairValue * (1 - effectiveMargin / 100));
    const currentBestBid = market.bestBid || 0;
    const edge = fairValue - currentBestBid;

    // Dynamic bid increment based on edge size for more aggressive entry
    // Larger edges = jump ahead in queue, smaller edges = conservative +1¢
    let bidIncrement = 1;
    if (edge > 10) {
        bidIncrement = 3;  // Huge edge: jump 3¢ ahead
    } else if (edge > 5) {
        bidIncrement = 2;  // Good edge: jump 2¢ ahead
    }

    let smartBid = currentBestBid + bidIncrement;
    let reason = bidIncrement > 1 ? `Beat Market +${bidIncrement}¢` : "Beat Market";

    // Alpha Strategy: Crossing the Spread (with Fee Protection)
    // If the Best Ask is significantly below our fair value, we take liquidity immediately
    // instead of waiting as a maker. However, we must account for Kalshi taker fees.
    //
    // Kalshi Taker Fee: ~7% of payout = ceil(0.07 * qty * price * (1-price))
    // Example: Buying 10 contracts at 50¢ = ~$1.75 in fees = ~1.75¢ per contract
    //
    // STRATEGY UPDATE: Reduced buffer from 3¢ to 1¢ for more aggressive spread crossing.
    // - At 3¢ buffer: Too conservative, missed many profitable opportunities
    // - At 1¢ buffer: Still protects against fees while capturing more edges
    // - Allows more aggressive taker behavior when edge is clear
    const TAKER_FEE_BUFFER = 1;

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
