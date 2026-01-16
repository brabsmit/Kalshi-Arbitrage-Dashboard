// File: src/utils/kalshiMatching.js

// Moved from App.jsx and expanded
export const SPORT_MAPPING = [
    { key: 'americanfootball_nfl', title: 'Football (NFL)', kalshiSeries: 'KXNFLGAME' },
    { key: 'basketball_nba', title: 'Basketball (NBA)', kalshiSeries: 'KXNBAGAME' },
    { key: 'baseball_mlb', title: 'Baseball (MLB)', kalshiSeries: 'KXMLBGAME' },
    { key: 'icehockey_nhl', title: 'Hockey (NHL)', kalshiSeries: 'KXNHLGAME' },
    { key: 'americanfootball_ncaaf', title: 'Football (NCAAF)', kalshiSeries: 'KXNCAAF' },
    { key: 'basketball_ncaab', title: 'Basketball (NCAAB)', kalshiSeries: 'KXNCAAMBGAME' },
    { key: 'cricket_test_match', title: 'Cricket (Test)', kalshiSeries: 'KXCRICKETTESTMATCH' },
];

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export const TEAM_ABBR = {
    // International Cricket
    'South Africa': 'SA', 'New Zealand': 'Z', 'West Indies': 'WIN', 'Sri Lanka': 'SL',

    // NFL
    'Green Bay Packers': 'GB', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC',
    'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC', 'Los Angeles Rams': 'LAR',
    'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
    'New York Jets': 'NYJ', 'San Francisco 49ers': 'SF', 'Tampa Bay Buccaneers': 'TB',

    // NBA
    'Brooklyn Nets': 'BKN', 'New York Knicks': 'NYK', 'Golden State Warriors': 'GS',
    'Los Angeles Lakers': 'LAL', 'Los Angeles Clippers': 'LAC', 'Phoenix Suns': 'PHX',
    'Oklahoma City Thunder': 'OKC', 'San Antonio Spurs': 'SAS', 'New Orleans Pelicans': 'NO',

    // NCAAF
    'Texas Tech Red Raiders': 'TTU', 'Texas Tech': 'TTU', 'Western Michigan Broncos': 'WMU',
    'Western Michigan': 'WMU', 'Miami (OH) RedHawks': 'MOH', 'Miami RedHawks': 'MOH', 'Miami (OH)': 'MOH',
    'Ohio State Buckeyes': 'OSU', 'Ohio State': 'OSU', 'Virginia Cavaliers': 'UVA', 'Virginia': 'UVA',
    'Georgia Bulldogs': 'UGA', 'Georgia': 'UGA', 'Michigan Wolverines': 'MICH', 'Michigan': 'MICH',
    'Washington Huskies': 'WASH', 'Washington': 'WASH', 'Florida State Seminoles': 'FSU', 'Florida State': 'FSU',
    'Clemson Tigers': 'CLEM', 'Clemson': 'CLEM', 'Notre Dame Fighting Irish': 'ND', 'Notre Dame': 'ND',
    'Penn State Nittany Lions': 'PSU', 'Penn State': 'PSU', 'Tennessee Volunteers': 'TENN', 'Tennessee': 'TENN',
    'Ole Miss Rebels': 'MISS', 'Ole Miss': 'MISS', 'Missouri Tigers': 'MIZZ', 'Missouri': 'MIZZ',
    'Kentucky Wildcats': 'UK', 'Kentucky': 'UK', 'Florida Gators': 'FLA', 'Florida': 'FLA',
    'Texas A&M Aggies': 'TAMU', 'Texas A&M': 'TAMU', 'Colorado Buffaloes': 'COLO', 'Colorado': 'COLO',
    'Utah Utes': 'UTAH', 'Utah': 'UTAH', 'Arizona Wildcats': 'ARIZ', 'Arizona': 'ARIZ',
    'Arizona State Sun Devils': 'ASU', 'Arizona State': 'ASU', 'North Carolina Tar Heels': 'UNC',
    'North Carolina': 'UNC', 'NC State Wolfpack': 'NCST', 'NC State': 'NCST', 'Iowa Hawkeyes': 'IOWA',
    'Iowa': 'IOWA', 'Wisconsin Badgers': 'WISC', 'Wisconsin': 'WISC', 'North Dakota State Bison': 'NDSU',
    'North Dakota State': 'NDSU', 'Illinois State Redbirds': 'ILST', 'Illinois State': 'ILST',
    'Navy Midshipmen': 'NAVY', 'Navy': 'NAVY', 'Army Black Knights': 'ARMY', 'Army': 'ARMY',

    // NCAAB
    'Kansas Jayhawks': 'KU', 'Kansas': 'KU', 'UConn Huskies': 'UCONN', 'UConn': 'UCONN',
    'Creighton Bluejays': 'CREI', 'Creighton': 'CREI', 'Marquette Golden Eagles': 'MARQ', 'Marquette': 'MARQ'
};

export const findKalshiMatch = (targetTeam, homeTeam, awayTeam, commenceTime, kalshiMarkets, seriesTicker) => {
    // ⚡ Bolt Optimization: Added early returns and removed array allocations
    if (!kalshiMarkets || !homeTeam || !awayTeam || !targetTeam) return null;

    let datePart = "";
    const date = new Date(commenceTime);
    if (!isNaN(date.getTime())) {
        // ⚡ Bolt Optimization: Use array lookup instead of expensive toLocaleString
        const yy = date.getFullYear().toString().slice(-2);
        const mmm = MONTHS[date.getMonth()];
        const dd = date.getDate().toString().padStart(2, '0');
        datePart = `${yy}${mmm}${dd}`;
    }

    const homeAbbr = TEAM_ABBR[homeTeam] || homeTeam.substring(0, 3).toUpperCase();
    const awayAbbr = TEAM_ABBR[awayTeam] || awayTeam.substring(0, 3).toUpperCase();
    const targetAbbr = TEAM_ABBR[targetTeam] || targetTeam.substring(0, 3).toUpperCase();

    // ⚡ Bolt Optimization: Replaced filter().find() chain with single loop to avoid allocating intermediate array
    // This reduces GC pressure and iterates the list only as far as needed (early exit)
    let exactMatch = null;

    // ⚡ Bolt Optimization: Use O(1) Lookup if Map is provided
    let candidates = kalshiMarkets;
    if (kalshiMarkets instanceof Map) {
        if (datePart && kalshiMarkets.has(datePart)) {
            candidates = kalshiMarkets.get(datePart);
        } else if (!datePart) {
            // If date invalid, must search all buckets
            candidates = [];
            for (const bucket of kalshiMarkets.values()) {
                for (const m of bucket) candidates.push(m);
            }
        } else if (kalshiMarkets.has('NONE')) {
            // Fallback to markets explicitly categorized as having no date
            candidates = kalshiMarkets.get('NONE');
        } else {
            // Valid date but no bucket found -> No match possible
            candidates = [];
        }
    }

    for (const k of candidates) {
        // ⚡ Bolt Optimization: Use pre-calculated uppercase ticker if available
        const ticker = k._uTicker || (k.ticker ? k.ticker.toUpperCase() : '');

        // 1. Filter Logic (in-loop)
        if (seriesTicker && !ticker.startsWith(seriesTicker)) continue;
        if (datePart && !ticker.includes(datePart)) continue;

        // 2. Exact Match Logic
        // Strict requirement: Ticker must contain both teams involved in the matchup
        if (ticker.includes(homeAbbr) && ticker.includes(awayAbbr)) {
            exactMatch = k;
            break; // Found the first match, stop iterating
        }
    }

    if (exactMatch) {
        const ticker = exactMatch.ticker.toUpperCase();
        const targetSuffix = `-${targetAbbr}`;

        // 1. Direct Match: Ticker ends with Target (e.g. -DUK)
        if (ticker.endsWith(targetSuffix)) {
            return exactMatch; // "Yes" side is Target
        }

        // 2. Inverse Match: Ticker ends with Opponent (e.g. -UNC)
        // Check if Opponent is Home or Away (whichever is NOT Target)
        const opponentTeam = targetTeam === homeTeam ? awayTeam : homeTeam;
        const opponentAbbr = TEAM_ABBR[opponentTeam] || opponentTeam.substring(0, 3).toUpperCase();
        const opponentSuffix = `-${opponentAbbr}`;

        if (ticker.endsWith(opponentSuffix)) {
            // "Yes" side is Opponent. Therefore Target is "No".
            // We return a Modified Market Object that "looks" like a Yes market for the Target,
            // but internally maps prices and sets a flag for execution.
            return {
                ...exactMatch,
                isInverse: true,
                // Map "No" prices to "Best Bid/Ask" for the Target
                // If I want to BUY Target (No), I pay the Ask price for No.
                // Kalshi API 'no_ask' is the lowest price someone is willing to sell 'No' for.
                yes_bid: exactMatch.no_bid,
                yes_ask: exactMatch.no_ask,
                // Swap explicit No/Yes fields just in case
                no_bid: exactMatch.yes_bid,
                no_ask: exactMatch.yes_ask
            };
        }
    }

    // Bernie says: Deleted "Strategy 2" (Fuzzy Matching).
    // It was dangerously clever and could match wrong teams (e.g. Arizona vs Atlanta).
    // If exact tickers don't match, we shouldn't bet.

    return null;
};
