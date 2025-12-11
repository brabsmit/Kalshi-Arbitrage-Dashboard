// File: src/utils/kalshiMatching.js

// Moved from App.jsx and expanded
export const SPORT_MAPPING = [
    { key: 'americanfootball_nfl', title: 'Football (NFL)', kalshiSeries: 'KXNFLGAME' },
    { key: 'basketball_nba', title: 'Basketball (NBA)', kalshiSeries: 'KXNBAGAME' },
    { key: 'baseball_mlb', title: 'Baseball (MLB)', kalshiSeries: 'KXMLBGAME' },
    { key: 'icehockey_nhl', title: 'Hockey (NHL)', kalshiSeries: 'KXNHLGAME' },
    { key: 'americanfootball_ncaaf', title: 'Football (NCAAF)', kalshiSeries: 'KXNCAAFGAME' },
    { key: 'basketball_ncaab', title: 'Basketball (NCAAB)', kalshiSeries: 'KXNCAAMBGAME' },
    { key: 'cricket_test_match', title: 'Cricket (Test)', kalshiSeries: 'KXCRICKETTESTMATCH' },
    { key: 'basketball_wncaab', title: 'Basketball (NCAAW)', kalshiSeries: 'KXNCAAWBGAME' },
];

export const TEAM_ABBR = {
    // International Cricket
    'India': 'IND', 'Australia': 'AUS', 'England': 'ENG', 'South Africa': 'RSA', 'New Zealand': 'Z', 'Pakistan': 'PAK', 'West Indies': 'WIN', 'Sri Lanka': 'SL', 'Bangladesh': 'BAN', 'Afghanistan': 'AFG', 'Zimbabwe': 'ZIM', 'Ireland': 'IRE',
    // NFL
    'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI', 'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB', 'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC', 'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG', 'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB', 'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
    // NBA
    'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN', 'New York Knicks': 'NYK', 'Philadelphia 76ers': 'PHI', 'Toronto Raptors': 'TOR', 'Golden State Warriors': 'GS', 'Los Angeles Lakers': 'LAL', 'Los Angeles Clippers': 'LAC', 'Phoenix Suns': 'PHX', 'Sacramento Kings': 'SAC', 'Dallas Mavericks': 'DAL', 'Houston Rockets': 'HOU', 'Oklahoma City Thunder': 'OKC', 'Denver Nuggets': 'DEN', 'Minnesota Timberwolves': 'MIN', 'Portland Trail Blazers': 'POR', 'Utah Jazz': 'UTA', 'San Antonio Spurs': 'SAS', 'Memphis Grizzlies': 'MEM', 'New Orleans Pelicans': 'NO', 'Detroit Pistons': 'DET', 'Indiana Pacers': 'IND', 'Milwaukee Bucks': 'MIL', 'Atlanta Hawks': 'ATL', 'Charlotte Hornets': 'CHA', 'Miami Heat': 'MIA', 'Orlando Magic': 'ORL', 'Washington Wizards': 'WAS',
    // NCAAF
    'Texas Tech Red Raiders': 'TTU', 'Texas Tech': 'TTU', 'BYU Cougars': 'BYU', 'BYU': 'BYU', 'Western Michigan Broncos': 'WMU', 'Western Michigan': 'WMU', 'Miami (OH) RedHawks': 'MOH', 'Miami RedHawks': 'MOH', 'Miami (OH)': 'MOH', 'Villanova Wildcats': 'VIL', 'Villanova': 'VIL', 'Lehigh Mountain Hawks': 'LEH', 'Lehigh': 'LEH', 'Ohio State Buckeyes': 'OSU', 'Ohio State': 'OSU', 'Indiana Hoosiers': 'IND', 'Indiana': 'IND', 'Virginia Cavaliers': 'UVA', 'Virginia': 'UVA', 'Duke Blue Devils': 'DUK', 'Duke': 'DUK', 'Georgia Bulldogs': 'UGA', 'Georgia': 'UGA', 'Alabama Crimson Tide': 'ALA', 'Alabama': 'ALA', 'Michigan Wolverines': 'MICH', 'Michigan': 'MICH', 'Washington Huskies': 'WASH', 'Washington': 'WASH', 'Texas Longhorns': 'TEX', 'Texas': 'TEX', 'Florida State Seminoles': 'FSU', 'Florida State': 'FSU', 'Oregon Ducks': 'ORE', 'Oregon': 'ORE', 'USC Trojans': 'USC', 'USC': 'USC', 'LSU Tigers': 'LSU', 'LSU': 'LSU', 'Clemson Tigers': 'CLEM', 'Clemson': 'CLEM', 'Notre Dame Fighting Irish': 'ND', 'Notre Dame': 'ND', 'Oklahoma Sooners': 'OKL', 'Oklahoma': 'OKL', 'Penn State Nittany Lions': 'PSU', 'Penn State': 'PSU', 'Tennessee Volunteers': 'TENN', 'Tennessee': 'TENN', 'Ole Miss Rebels': 'MISS', 'Ole Miss': 'MISS', 'Missouri Tigers': 'MIZZ', 'Missouri': 'MIZZ', 'Louisville Cardinals': 'LOU', 'Louisville': 'LOU', 'Kentucky Wildcats': 'UK', 'Kentucky': 'UK', 'Florida Gators': 'FLA', 'Florida': 'FLA', 'Auburn Tigers': 'AUB', 'Auburn': 'AUB', 'Arkansas Razorbacks': 'ARK', 'Arkansas': 'ARK', 'Texas A&M Aggies': 'TAMU', 'Texas A&M': 'TAMU', 'Colorado Buffaloes': 'COLO', 'Colorado': 'COLO', 'Utah Utes': 'UTAH', 'Utah': 'UTAH', 'Arizona Wildcats': 'ARIZ', 'Arizona': 'ARIZ', 'Arizona State Sun Devils': 'ASU', 'Arizona State': 'ASU', 'North Carolina Tar Heels': 'UNC', 'North Carolina': 'UNC', 'NC State Wolfpack': 'NCST', 'NC State': 'NCST', 'Miami Hurricanes': 'MIA', 'Miami': 'MIA', 'Iowa Hawkeyes': 'IOWA', 'Iowa': 'IOWA', 'Wisconsin Badgers': 'WISC', 'Wisconsin': 'WISC', 'North Dakota State Bison': 'NDSU', 'North Dakota State': 'NDSU', 'Illinois State Redbirds': 'ILST', 'Illinois State': 'ILST',
    // NCAAB
    'Kansas Jayhawks': 'KU', 'Kansas': 'KU', 'UConn Huskies': 'UCONN', 'UConn': 'UCONN', 'Houston Cougars': 'HOU', 'Houston': 'HOU', 'Purdue Boilermakers': 'PUR', 'Purdue': 'PUR', 'Creighton Bluejays': 'CREI', 'Creighton': 'CREI', 'Marquette Golden Eagles': 'MARQ', 'Marquette': 'MARQ', 'Illinois Fighting Illini': 'ILL', 'Illinois': 'ILL', 'Baylor Bears': 'BAY', 'Baylor': 'BAY', 'North Carolina Tar Heels': 'UNC', 'North Carolina': 'UNC', 'Duke Blue Devils': 'DUK', 'Duke': 'DUK'
};

export const findKalshiMatch = (targetTeam, homeTeam, awayTeam, commenceTime, kalshiMarkets, seriesTicker) => {
    if (!kalshiMarkets || !homeTeam || !awayTeam || !targetTeam) return null;

    let datePart = "";
    const date = new Date(commenceTime);
    if (!isNaN(date.getTime())) {
        const yy = date.getFullYear().toString().slice(-2);
        const mmm = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        const dd = date.getDate().toString().padStart(2, '0');
        datePart = `${yy}${mmm}${dd}`;
    }

    // Filter Candidates by Series and Date first to narrow down
    const candidates = kalshiMarkets.filter(k => {
        const ticker = k.ticker ? k.ticker.toUpperCase() : '';
        if (seriesTicker && !ticker.startsWith(seriesTicker)) return false;
        if (datePart && !ticker.includes(datePart)) return false;
        return true;
    });

    if (candidates.length === 0) return null;

    const homeAbbr = TEAM_ABBR[homeTeam] || homeTeam.substring(0, 3).toUpperCase();
    const awayAbbr = TEAM_ABBR[awayTeam] || awayTeam.substring(0, 3).toUpperCase();
    const targetAbbr = TEAM_ABBR[targetTeam] || targetTeam.substring(0, 3).toUpperCase();

    // ---------------------------------------------------------
    // STRATEGY 1: Exact Abbreviation Match with Inversion Logic
    // ---------------------------------------------------------
    const exactMatch = candidates.find(k => {
        const ticker = k.ticker.toUpperCase();
        // Strict requirement: Ticker must contain both teams involved in the matchup
        const hasTeams = (ticker.includes(homeAbbr) && ticker.includes(awayAbbr));
        return hasTeams;
    });

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

    // ---------------------------------------------------------
    // STRATEGY 2: Fuzzy Title Matching (Fallback)
    // ---------------------------------------------------------

    // Normalize string: lowercase, remove special chars
    const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

    const getSignificantWords = (name) => {
        return name.toLowerCase().split(' ')
            .filter(w => w.length > 2 && !['university', 'state', 'tech', 'college'].includes(w));
    };

    const targetWords = getSignificantWords(targetTeam);
    const homeWords = getSignificantWords(homeTeam);
    const awayWords = getSignificantWords(awayTeam);

    const useFull = (words, name) => words.length > 0 ? words : [name.toLowerCase()];

    const tWords = useFull(targetWords, targetTeam);
    const hWords = useFull(homeWords, homeTeam);
    const aWords = useFull(awayWords, awayTeam);

    const titleMatch = candidates.find(k => {
        if (!k.title) return false;
        const titleLower = k.title.toLowerCase();

        const hasHome = hWords.some(w => titleLower.includes(w));
        const hasAway = aWords.some(w => titleLower.includes(w));

        if (!hasHome || !hasAway) return false;

        // Logic to determine side from title/ticker suffix
        const parts = k.ticker.split('-');
        const suffix = parts[parts.length - 1];

        const targetFirst = targetTeam.charAt(0).toLowerCase();
        const suffixFirst = suffix.charAt(0).toLowerCase();

        // Heuristic: If suffix matches Target, return Direct
        if (targetFirst === suffixFirst) return true;

        return false;
    });

    if (titleMatch) {
         // Check inverse logic for fuzzy match too?
         // For now, return direct match as existing logic did, but ideally we apply same inverse logic here.
         // Let's assume title match implies direct for now to be safe, or we risk false positive inversions.
         return titleMatch;
    }

    return null;
};
