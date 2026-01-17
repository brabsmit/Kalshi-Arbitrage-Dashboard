// File: src/utils/marketIndexing.js
// Normalized market key system for reliable Kalshi ↔ Odds API matching

/**
 * Normalizes a team name for consistent matching
 * - Strips team suffixes (Mavericks, Jazz, etc.) to match Kalshi's city-only format
 * - Removes special characters and spaces
 * - Converts to uppercase
 * - Handles common abbreviations
 */
const normalizeTeamName = (teamName) => {
    if (!teamName) return '';

    let normalized = teamName.toUpperCase();

    // Strip common team suffixes that Odds API includes but Kalshi doesn't
    // NBA teams
    normalized = normalized.replace(/\s+(MAVERICKS|JAZZ|HAWKS|CELTICS|PISTONS|PACERS)$/, '');
    normalized = normalized.replace(/\s+(76ERS|SIXERS|HEAT|THUNDER|WARRIORS|SUNS|LAKERS)$/, '');
    normalized = normalized.replace(/\s+(CLIPPERS|TRAIL\s*BLAZERS|BLAZERS|KINGS|SPURS|GRIZZLIES)$/, '');
    normalized = normalized.replace(/\s+(PELICANS|ROCKETS|TIMBERWOLVES|NUGGETS|BUCKS|BULLS)$/, '');
    normalized = normalized.replace(/\s+(CAVALIERS|CAVS|RAPTORS|NETS|KNICKS|WIZARDS|HORNETS|MAGIC)$/, '');

    // Remove remaining spaces and special chars
    normalized = normalized
        .replace(/\s+/g, '')           // Remove all spaces
        .replace(/[^A-Z0-9]/g, '')     // Remove special chars
        .replace(/SAINT/g, 'ST')       // St. Louis → STLOUIS
        .replace(/&/g, 'AND')          // Texas A&M → TEXASAM
        .substring(0, 15);             // Limit length

    return normalized;
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

    // Normalize date to YYYY-MM-DD using LOCAL timezone (matches old matching system)
    let dateStr = '';
    try {
        // If gameDate is already a YYYY-MM-DD string, use it directly
        if (typeof gameDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(gameDate)) {
            dateStr = gameDate;
        } else {
            // For timestamps, extract date components in LOCAL timezone (not UTC)
            // This matches the old system which used .getFullYear(), .getMonth(), .getDate()
            const date = new Date(gameDate);
            if (!isNaN(date.getTime())) {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                dateStr = `${year}-${month}-${day}`;
            }
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
 * Parses date from Kalshi event ticker
 * Format: "KXNBAGAME-26JAN19LACWAS" -> "2026-01-19"
 * Returns: ISO date string or null if parsing fails
 */
export const parseDateFromEventTicker = (eventTicker) => {
    if (!eventTicker) return null;

    // Match pattern: SERIES-YYMMMDDTEAMS
    // Example: KXNBAGAME-26JAN19LACWAS
    const match = eventTicker.match(/-(\d{2})([A-Z]{3})(\d{2})/);
    if (!match) return null;

    const [, year, monthStr, day] = match;
    const monthMap = {
        'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
        'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
        'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
    };

    const month = monthMap[monthStr];
    if (!month) return null;

    // Convert 2-digit year to 4-digit (assume 20xx)
    const fullYear = `20${year}`;

    return `${fullYear}-${month}-${day.padStart(2, '0')}`;
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

        // Extract game date from timestamp (expected_expiration_time is most accurate)
        // NOTE: event_ticker date is unreliable (shows original schedule, not actual game date)
        const timestamp = market.expected_expiration_time || market.event_start_time || market.close_time;
        if (!timestamp) {
            console.warn('[INDEX] Missing date for market:', market.ticker);
            continue;
        }
        const gameDate = timestamp;

        // Generate market key (teams sorted alphabetically)
        const key = generateMarketKey(sport, away, home, gameDate);
        if (!key) continue;

        // DEBUG: Log first 3 keys with their source data
        if (indexed < 3) {
            console.log(`[INDEX] Key ${indexed + 1}:`, key);
            console.log(`  Title: "${market.title}"`);
            console.log(`  Teams: "${away}" at "${home}"`);
            console.log(`  Timestamp: ${gameDate}`);
            console.log(`  Ticker: ${market.ticker}`);
        }

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
        // Strategy: Check if the ticker's winner code (last part) is contained in the team name
        // Example: ticker "KXNBAGAME-26JAN19INDPHI-IND" → winnerCode="IND", away="Indiana", home="Philadelphia"
        // "Indiana".toUpperCase() contains "IND" → this is betting on away team
        const awayUpper = away.toUpperCase();
        const homeUpper = home.toUpperCase();
        const winnerUpper = winnerCode.toUpperCase();

        // Check which team the market is betting on
        const isAwayMarket = awayUpper.includes(winnerUpper) || awayUpper.startsWith(winnerUpper);
        const isHomeMarket = homeUpper.includes(winnerUpper) || homeUpper.startsWith(winnerUpper);

        if (isAwayMarket) {
            entry.away = marketData;
            if (indexed < 3) console.log(`  → Assigned to AWAY (${away})`);
        } else if (isHomeMarket) {
            entry.home = marketData;
            if (indexed < 3) console.log(`  → Assigned to HOME (${home})`);
        } else {
            // Fallback: assume first market is away, second is home
            if (!entry.away) {
                entry.away = marketData;
                if (indexed < 3) console.log(`  → Assigned to AWAY (fallback, ${away})`);
            } else {
                entry.home = marketData;
                if (indexed < 3) console.log(`  → Assigned to HOME (fallback, ${home})`);
            }
        }

        indexed++;
    }

    // Extract unique dates from index to see what dates Kalshi has markets for
    const uniqueDates = new Set();
    for (const key of index.keys()) {
        const datePart = key.split(':')[1]; // Extract YYYY-MM-DD from key
        uniqueDates.add(datePart);
    }

    console.log(`[INDEX] Indexed ${indexed} Kalshi markets (${parseFailures} parse failures) for ${sport}`);
    console.log(`[INDEX] Unique dates in index:`, Array.from(uniqueDates).sort());

    // DEBUG: Show all Jan 17 games
    const jan17Keys = Array.from(index.keys()).filter(k => k.includes('2026-01-17'));
    if (jan17Keys.length > 0) {
        console.log(`[INDEX] Jan 17 games (${jan17Keys.length}):`, jan17Keys);
    }

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
    if (!entry) {
        // DEBUG: Log first 3 lookup failures
        if (!findMatchInIndex._failCount) findMatchInIndex._failCount = 0;
        if (findMatchInIndex._failCount < 3) {
            console.log(`[MATCH FAIL ${findMatchInIndex._failCount + 1}] Looking for:`, key);
            console.log(`  Home: "${homeTeam}", Away: "${awayTeam}"`);
            console.log(`  Timestamp: ${gameDate}`);
            console.log(`  Index keys sample:`, Array.from(index.keys()).slice(0, 2));
            findMatchInIndex._failCount++;
        }
        return null;
    }

    console.log('[MATCH SUCCESS]', key);

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
