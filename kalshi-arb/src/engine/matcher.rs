use std::collections::HashMap;
use chrono::NaiveDate;

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub struct MarketKey {
    pub sport: String,
    pub date: NaiveDate,
    pub teams: [String; 2], // sorted alphabetically
}

/// One side (home or away) of a Kalshi game market.
#[derive(Debug, Clone)]
pub struct SideMarket {
    pub ticker: String,
    pub title: String,
    pub yes_bid: u32,
    pub yes_ask: u32,
    pub no_bid: u32,
    pub no_ask: u32,
}

/// Both sides of a game stored in the index.
/// Kalshi creates two markets per game: one for each team winning.
#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
pub struct IndexedGame {
    pub away: Option<SideMarket>,
    pub home: Option<SideMarket>,
    pub away_team: String,
    pub home_team: String,
}

/// Result of looking up a market — includes whether we had to invert.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct MatchedMarket {
    pub ticker: String,
    pub title: String,
    pub is_inverse: bool,
    pub best_bid: u32,
    pub best_ask: u32,
}

/// Normalizes a team name by stripping mascots and keeping location.
/// Matches the JS dashboard logic: suffix must be at end preceded by whitespace.
pub fn normalize_team(name: &str) -> String {
    let mut s = name.to_uppercase();
    s = s.replace("SAINT", "ST");
    s = s.replace('&', "AND");
    s = s.replace('.', "");
    // Normalize whitespace
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut s = s.trim().to_string();

    // Common mascots/suffixes to strip — must appear at end preceded by space
    let suffixes = [
        // NBA
        "MAVERICKS", "JAZZ", "HAWKS", "CELTICS", "PISTONS", "PACERS", "HEAT",
        "THUNDER", "WARRIORS", "SUNS", "LAKERS", "CLIPPERS", "BLAZERS", "KINGS",
        "SPURS", "GRIZZLIES", "PELICANS", "ROCKETS", "TIMBERWOLVES", "NUGGETS",
        "BUCKS", "BULLS", "CAVALIERS", "RAPTORS", "NETS", "KNICKS", "WIZARDS",
        "HORNETS", "MAGIC", "TRAIL BLAZERS", "76ERS", "SIXERS", "CAVS",
        // NFL
        "PACKERS", "BEARS", "LIONS", "VIKINGS", "COWBOYS", "GIANTS", "EAGLES",
        "COMMANDERS", "REDSKINS", "BUCCANEERS", "SAINTS", "FALCONS", "PANTHERS",
        "RAMS", "SEAHAWKS", "49ERS", "NINERS", "CARDINALS", "RAVENS", "BENGALS",
        "BROWNS", "STEELERS", "TEXANS", "COLTS", "JAGUARS", "TITANS", "BRONCOS",
        "CHIEFS", "RAIDERS", "CHARGERS", "BILLS", "DOLPHINS", "PATRIOTS", "JETS",
        // NHL
        "BRUINS", "SABRES", "RED WINGS", "BLACKHAWKS", "AVALANCHE", "BLUE JACKETS",
        "WILD", "PREDATORS", "BLUES", "FLAMES", "OILERS", "CANUCKS", "DUCKS",
        "COYOTES", "GOLDEN KNIGHTS", "KRAKEN", "SHARKS", "HURRICANES", "LIGHTNING",
        "CAPITALS", "FLYERS", "PENGUINS", "RANGERS", "ISLANDERS", "DEVILS",
        "MAPLE LEAFS", "SENATORS", "CANADIENS",
        // MLB
        "RED SOX", "YANKEES", "ORIOLES", "RAYS", "WHITE SOX", "INDIANS", "GUARDIANS",
        "TIGERS", "ROYALS", "TWINS", "ASTROS", "ANGELS", "ATHLETICS", "MARINERS",
        "BRAVES", "MARLINS", "METS", "PHILLIES", "NATIONALS", "CUBS", "REDS",
        "BREWERS", "PIRATES", "DIAMONDBACKS", "ROCKIES", "DODGERS", "PADRES",
        // College
        "AGGIES", "WILDCATS", "BULLDOGS", "CRIMSON TIDE", "VOLUNTEERS",
        "GATORS", "GAMECOCKS", "RAZORBACKS", "LONGHORNS", "SOONERS", "JAYHAWKS",
        "CYCLONES", "MOUNTAINEERS", "HUSKIES", "TROJANS",
        "CARDINAL", "SUN DEVILS", "GOLDEN BEARS", "BEAVERS", "COUGARS", "UTES",
        "BUFFALOES", "CORNHUSKERS", "BADGERS", "HAWKEYES", "SPARTANS", "WOLVERINES",
        "BUCKEYES", "NITTANY LIONS", "TERRAPINS", "SCARLET KNIGHTS", "HOOSIERS",
        "FIGHTING IRISH", "BLUE DEVILS", "TAR HEELS", "ORANGE", "DEMON DEACONS",
        "YELLOW JACKETS", "SEMINOLES", "ORANGEMEN",
    ];

    for suffix in &suffixes {
        // Match JS behavior: suffix must be at end of string, preceded by whitespace
        if let Some(stripped) = s.strip_suffix(suffix) {
            let stripped = stripped.trim_end();
            if !stripped.is_empty() {
                s = stripped.to_string();
                break;
            }
        }
    }

    // Remove all spaces and non-alphanumeric
    s.retain(|c| c.is_ascii_alphanumeric());
    s.truncate(20);
    s
}

/// Generate a deterministic market key.
pub fn generate_key(sport: &str, team1: &str, team2: &str, date: NaiveDate) -> Option<MarketKey> {
    let n1 = normalize_team(team1);
    let n2 = normalize_team(team2);
    if n1.is_empty() || n2.is_empty() {
        return None;
    }
    let mut teams = [n1, n2];
    teams.sort();
    Some(MarketKey {
        sport: sport.to_uppercase().chars().filter(|c| c.is_ascii_alphabetic()).collect(),
        date,
        teams,
    })
}

/// Parse date from Kalshi event ticker.
/// Format: "KXNBAGAME-26JAN19LACWAS" -> 2026-01-19
pub fn parse_date_from_ticker(ticker: &str) -> Option<NaiveDate> {
    for part in ticker.split('-').skip(1) {
        if part.len() >= 7 {
            let year_str = &part[0..2];
            let month_str = &part[2..5];
            let day_str = &part[5..7];

            if let (Ok(year), Ok(day)) = (year_str.parse::<i32>(), day_str.parse::<u32>()) {
                let month = match month_str {
                    "JAN" => Some(1), "FEB" => Some(2), "MAR" => Some(3),
                    "APR" => Some(4), "MAY" => Some(5), "JUN" => Some(6),
                    "JUL" => Some(7), "AUG" => Some(8), "SEP" => Some(9),
                    "OCT" => Some(10), "NOV" => Some(11), "DEC" => Some(12),
                    _ => None,
                };
                if let Some(m) = month {
                    return NaiveDate::from_ymd_opt(2000 + year, m, day);
                }
            }
        }
    }
    None
}

/// Parse Kalshi title: "Team1 at Team2 Winner?" -> (away, home)
/// Also handles "Team1 vs Team2 Winner?" and titles without "Winner?"
pub fn parse_kalshi_title(title: &str) -> Option<(String, String)> {
    let lower = title.to_lowercase();
    let (away, home) = if let Some(pos) = lower.find(" at ") {
        let away = &title[..pos];
        let rest = &title[pos + 4..];
        let home = rest.trim_end_matches(" Winner?").trim_end_matches('?');
        (away.to_string(), home.to_string())
    } else if let Some(pos) = lower.find(" vs ") {
        let away = &title[..pos];
        let rest = &title[pos + 4..];
        let home = rest.trim_end_matches(" Winner?").trim_end_matches('?');
        (away.to_string(), home.to_string())
    } else {
        return None;
    };
    Some((away, home))
}

/// Determine which team a market is for by parsing the ticker's winner code.
/// Ticker format: KXNBAGAME-26JAN19LACWAS-LAC
/// The middle segment after the date (7 chars) encodes both teams: away first, home second.
/// The final segment is the winner code for this specific market.
pub fn is_away_market(ticker: &str, away: &str, home: &str) -> Option<bool> {
    let parts: Vec<&str> = ticker.split('-').collect();
    if parts.len() < 3 {
        return None;
    }
    let winner_code = parts.last()?.to_uppercase();

    // Primary: use the game-info segment to determine position
    // E.g., "26JAN19LACWAS" -> strip 7-char date -> "LACWAS"
    // If winner code starts the teams part, it's the away team (listed first)
    // If winner code ends the teams part, it's the home team (listed second)
    if let Some(game_part) = parts.get(1) {
        let game_upper = game_part.to_uppercase();
        if game_upper.len() > 7 {
            let teams_part = &game_upper[7..];
            if teams_part.starts_with(&winner_code) {
                return Some(true); // winner code is first = away team
            }
            if teams_part.ends_with(&winner_code) {
                return Some(false); // winner code is last = home team
            }
        }
    }

    // Fallback: substring match on full names
    let away_upper = away.to_uppercase();
    let home_upper = home.to_uppercase();
    let matches_away = away_upper.contains(&winner_code) || away_upper.starts_with(&winner_code);
    let matches_home = home_upper.contains(&winner_code) || home_upper.starts_with(&winner_code);

    if matches_away && !matches_home {
        Some(true)
    } else if matches_home && !matches_away {
        Some(false)
    } else {
        None
    }
}

/// Find a matched market from the index for a given game.
/// Returns the market with correct bid/ask orientation.
pub fn find_match(
    index: &MarketIndex,
    sport: &str,
    home_team: &str,
    away_team: &str,
    date: NaiveDate,
) -> Option<MatchedMarket> {
    let key = generate_key(sport, home_team, away_team, date)?;
    let game = index.get(&key)?;

    // Prefer home market (direct match for home team odds)
    if let Some(ref home) = game.home {
        return Some(MatchedMarket {
            ticker: home.ticker.clone(),
            title: home.title.clone(),
            is_inverse: false,
            best_bid: home.yes_bid,
            best_ask: home.yes_ask,
        });
    }

    // Fall back to away market with inverse (swap yes/no)
    if let Some(ref away) = game.away {
        return Some(MatchedMarket {
            ticker: away.ticker.clone(),
            title: away.title.clone(),
            is_inverse: true,
            best_bid: away.no_bid,
            best_ask: away.no_ask,
        });
    }

    None
}

pub type MarketIndex = HashMap<MarketKey, IndexedGame>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_team() {
        assert_eq!(normalize_team("Dallas Mavericks"), "DALLAS");
        assert_eq!(normalize_team("Los Angeles Lakers"), "LOSANGELES");
        assert_eq!(normalize_team("New York Knicks"), "NEWYORK");
        assert_eq!(normalize_team("Oklahoma City Thunder"), "OKLAHOMACITY");
    }

    #[test]
    fn test_generate_key_sorted() {
        let d = NaiveDate::from_ymd_opt(2026, 1, 19).unwrap();
        let k1 = generate_key("NBA", "Lakers", "Celtics", d).unwrap();
        let k2 = generate_key("NBA", "Celtics", "Lakers", d).unwrap();
        assert_eq!(k1, k2); // same regardless of order
    }

    #[test]
    fn test_parse_date_from_ticker() {
        let d = parse_date_from_ticker("KXNBAGAME-26JAN19LACWAS").unwrap();
        assert_eq!(d, NaiveDate::from_ymd_opt(2026, 1, 19).unwrap());
    }

    #[test]
    fn test_parse_kalshi_title() {
        let (away, home) = parse_kalshi_title("Dallas Mavericks at Los Angeles Lakers Winner?").unwrap();
        assert_eq!(away, "Dallas Mavericks");
        assert_eq!(home, "Los Angeles Lakers");
    }

    #[test]
    fn test_is_away_market() {
        // IND in "Indiana Pacers" → away
        assert_eq!(
            is_away_market("KXNBAGAME-26JAN19INDPHI-IND", "Indiana Pacers", "Philadelphia 76ers"),
            Some(true)
        );
        // PHI in "Philadelphia 76ers" → home
        assert_eq!(
            is_away_market("KXNBAGAME-26JAN19INDPHI-PHI", "Indiana Pacers", "Philadelphia 76ers"),
            Some(false)
        );
        // Multi-word city abbreviations (LAC) resolved via ticker segment
        assert_eq!(
            is_away_market("KXNBAGAME-26JAN19LACWAS-LAC", "Los Angeles Clippers", "Washington Wizards"),
            Some(true),
        );
    }

    #[test]
    fn test_is_away_market_from_ticker_segment() {
        // LAC appears first in "LACWAS" = away, winner code "LAC" = away market
        assert_eq!(
            is_away_market("KXNBAGAME-26JAN19LACWAS-LAC", "Los Angeles Clippers", "Washington Wizards"),
            Some(true),
        );
        // WAS appears second in "LACWAS" = home, winner code "WAS" = home market
        assert_eq!(
            is_away_market("KXNBAGAME-26JAN19LACWAS-WAS", "Los Angeles Clippers", "Washington Wizards"),
            Some(false),
        );
    }
}
