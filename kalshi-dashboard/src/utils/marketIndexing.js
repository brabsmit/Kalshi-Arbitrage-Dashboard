// File: src/utils/marketIndexing.js
// Normalized market key system for reliable Kalshi ↔ Odds API matching

/**
 * Normalizes a team name for consistent matching
 * - Removes special characters and spaces
 * - Converts to uppercase
 * - Handles common abbreviations
 */
const normalizeTeamName = (teamName) => {
    if (!teamName) return '';

    return teamName
        .toUpperCase()
        .replace(/\s+/g, '')           // Remove all spaces
        .replace(/[^A-Z0-9]/g, '')     // Remove special chars (parentheses, apostrophes, etc)
        .replace(/SAINT/g, 'ST')       // St. Louis → STLOUIS
        .replace(/&/g, 'AND')          // Texas A&M → TEXASAM
        .substring(0, 15);             // Limit length for key size
};

/**
 * Generates a deterministic market key from structured data
 * Format: SPORT:YYYY-MM-DD:TEAM1vTEAM2
 */
export const generateMarketKey = (sport, team1, team2, gameDate) => {
    // Normalize teams and sort alphabetically for consistency
    // (doesn't matter which team is "home" - we'll index both directions)
    const normalized1 = normalizeTeamName(team1);
    const normalized2 = normalizeTeamName(team2);

    if (!normalized1 || !normalized2) return null;

    const sortedTeams = [normalized1, normalized2].sort();

    // Normalize date to YYYY-MM-DD
    let dateStr = '';
    try {
        const date = new Date(gameDate);
        if (!isNaN(date.getTime())) {
            dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        }
    } catch (e) {
        console.warn('[INDEX] Invalid date:', gameDate);
        return null;
    }

    if (!dateStr) return null;

    // Sport key (uppercase for consistency)
    const sportKey = (sport || 'UNKNOWN').toUpperCase().replace(/[^A-Z]/g, '');

    return `${sportKey}:${dateStr}:${sortedTeams[0]}v${sortedTeams[1]}`;
};

/**
 * Parses Kalshi market title to extract teams
 * Format: "Team1 at Team2 Winner?" or "Team1 vs Team2 Winner?"
 * Returns: [awayTeam, homeTeam] or [null, null] if parsing fails
 */
export const parseKalshiTitle = (title) => {
    if (!title) return [null, null];

    // Match patterns: "X at Y Winner?" or "X vs Y Winner?"
    const match = title.match(/^(.+?)\s+(?:at|vs)\s+(.+?)\s+Winner\?$/i);

    if (!match) {
        // Try alternate pattern without "Winner?"
        const altMatch = title.match(/^(.+?)\s+(?:at|vs)\s+(.+?)$/i);
        if (!altMatch) {
            console.warn('[INDEX] Failed to parse Kalshi title:', title);
            return [null, null];
        }
        return [altMatch[1].trim(), altMatch[2].trim()];
    }

    return [match[1].trim(), match[2].trim()]; // [away, home]
};

/**
 * Builds an index of Kalshi markets for O(1) lookup
 * Returns a Map: marketKey → { yes: market, no: market, metadata }
 */
export const buildKalshiIndex = (kalshiMarkets, sport) => {
    const index = new Map();
    let parseFailures = 0;
    let indexed = 0;

    for (const market of kalshiMarkets) {
        const [away, home] = parseKalshiTitle(market.title);

        if (!away || !home) {
            parseFailures++;
            continue;
        }

        // Extract game date from close_time or event_start_time
        const gameDate = market.event_start_time || market.close_time;
        if (!gameDate) {
            console.warn('[INDEX] Missing date for market:', market.ticker);
            continue;
        }

        // Generate market key (teams sorted alphabetically)
        const key = generateMarketKey(sport, away, home, gameDate);
        if (!key) continue;

        // Determine which side this market represents
        // Kalshi ticker format: SERIES-DATEAWAY/HOME-WINNER
        // Example: KXNBAGAME-26JAN19LACWAS-LAC means "LAC wins"
        const ticker = market.ticker || '';
        const tickerParts = ticker.split('-');
        const winnerCode = tickerParts[tickerParts.length - 1]; // Last part is winner

        // Store market with metadata
        const marketData = {
            market: market,
            away: away,
            home: home,
            winnerSide: winnerCode, // The team abbreviation that this market is betting on
            ticker: ticker
        };

        // Get or create index entry
        if (!index.has(key)) {
            index.set(key, {
                away: null,
                home: null,
                metadata: { key, away, home, gameDate }
            });
        }

        const entry = index.get(key);

        // Determine if this market is betting on away or home team
        // We'll use team name matching to determine which side
        const awayNorm = normalizeTeamName(away);
        const homeNorm = normalizeTeamName(home);
        const winnerNorm = normalizeTeamName(winnerCode);

        // Check which team the market is betting on
        if (ticker.includes(awayNorm) && winnerNorm && (winnerNorm === awayNorm || away.toUpperCase().includes(winnerNorm))) {
            entry.away = marketData;
        } else if (ticker.includes(homeNorm) && winnerNorm && (winnerNorm === homeNorm || home.toUpperCase().includes(winnerNorm))) {
            entry.home = marketData;
        } else {
            // Fallback: assume first market is away, second is home
            if (!entry.away) {
                entry.away = marketData;
            } else {
                entry.home = marketData;
            }
        }

        indexed++;
    }

    console.log(`[INDEX] Indexed ${indexed} Kalshi markets (${parseFailures} parse failures) for ${sport}`);

    return index;
};

/**
 * Finds matching Kalshi market for an Odds API game
 * Returns matched market with isInverse flag if needed
 */
export const findMatchInIndex = (index, sport, targetTeam, homeTeam, awayTeam, gameDate) => {
    if (!index || !targetTeam || !homeTeam || !awayTeam) return null;

    // Generate key for this game using the actual sport key
    const key = generateMarketKey(sport, homeTeam, awayTeam, gameDate);
    if (!key) return null;

    // Look up in index
    const entry = index.get(key);
    if (!entry) return null;

    // Determine which side the target team is on
    const targetNorm = normalizeTeamName(targetTeam);
    const awayNorm = normalizeTeamName(awayTeam);
    const homeNorm = normalizeTeamName(homeTeam);

    // Check if target matches away team
    if (targetNorm === awayNorm) {
        if (entry.away) {
            // Target is away team, and we have an away market → direct match
            return {
                ...entry.away.market,
                isInverse: false
            };
        } else if (entry.home) {
            // Target is away, but only home market exists → inverse match
            return {
                ...entry.home.market,
                isInverse: true,
                yes_bid: entry.home.market.no_bid,
                yes_ask: entry.home.market.no_ask,
                no_bid: entry.home.market.yes_bid,
                no_ask: entry.home.market.yes_ask
            };
        }
    }

    // Check if target matches home team
    if (targetNorm === homeNorm) {
        if (entry.home) {
            // Target is home team, and we have a home market → direct match
            return {
                ...entry.home.market,
                isInverse: false
            };
        } else if (entry.away) {
            // Target is home, but only away market exists → inverse match
            return {
                ...entry.away.market,
                isInverse: true,
                yes_bid: entry.away.market.no_bid,
                yes_ask: entry.away.market.no_ask,
                no_bid: entry.away.market.yes_bid,
                no_ask: entry.away.market.yes_ask
            };
        }
    }

    return null;
};

/**
 * Diagnostic function to log index statistics
 */
export const logIndexStats = (index) => {
    const total = index.size;
    let bothSides = 0;
    let awayOnly = 0;
    let homeOnly = 0;

    for (const [key, entry] of index.entries()) {
        if (entry.away && entry.home) bothSides++;
        else if (entry.away) awayOnly++;
        else if (entry.home) homeOnly++;
    }

    console.log(`[INDEX STATS] Total matchups: ${total}`);
    console.log(`[INDEX STATS] Both sides: ${bothSides}, Away only: ${awayOnly}, Home only: ${homeOnly}`);

    return { total, bothSides, awayOnly, homeOnly };
};
