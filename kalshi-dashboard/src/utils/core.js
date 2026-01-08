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

    // Alpha Strategy: Dynamic Volatility Padding
    // If the market is volatile (high standard deviation in source odds), we increase the required margin.
    // This protects against adverse selection during rapid repricing events.
    const volatility = market.volatility || 0;
    // UPDATED: Reduce volatility impact to 25% to be more aggressive
    const effectiveMargin = marginPercent + (volatility * 0.25);

    const maxWillingToPay = Math.floor(fairValue * (1 - effectiveMargin / 100));
    const currentBestBid = market.bestBid || 0;
    const edge = fairValue - currentBestBid;

    let smartBid = currentBestBid + 1;
    let reason = "Beat Market";

    // Alpha Strategy: Crossing the Spread
    // If the Best Ask is bargain-basement cheap (below our willingness to pay),
    // we take the liquidity immediately instead of fishing for a bid.
    // We add a small buffer (e.g. 2 cents) to cover Taker fees.
    // UPDATED: Set buffer to 0 to chase hard for small arbitrage (speed over fees)
    const TAKER_FEE_BUFFER = 0;

    // Check if we can buy immediately at a discount
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
