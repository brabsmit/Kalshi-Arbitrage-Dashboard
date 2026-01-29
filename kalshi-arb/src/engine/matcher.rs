use std::collections::HashMap;
use chrono::NaiveDate;

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub struct MarketKey {
    pub sport: String,
    pub date: NaiveDate,
    pub teams: [String; 2], // sorted alphabetically
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct IndexedMarket {
    pub ticker: String,
    pub title: String,
    pub is_inverse: bool,
    pub best_bid: u32,
    pub best_ask: u32,
}

/// Normalizes a team name by stripping mascots and keeping location.
pub fn normalize_team(name: &str) -> String {
    let mut s = name.to_uppercase();
    s = s.replace("SAINT", "ST");
    s = s.replace('&', "AND");
    s = s.replace('.', "");

    // Common mascots/suffixes to strip
    let suffixes = [
        "MAVERICKS", "JAZZ", "HAWKS", "CELTICS", "PISTONS", "PACERS", "HEAT",
        "THUNDER", "WARRIORS", "SUNS", "LAKERS", "CLIPPERS", "BLAZERS", "KINGS",
        "SPURS", "GRIZZLIES", "PELICANS", "ROCKETS", "TIMBERWOLVES", "NUGGETS",
        "BUCKS", "BULLS", "CAVALIERS", "RAPTORS", "NETS", "KNICKS", "WIZARDS",
        "HORNETS", "MAGIC", "TRAIL BLAZERS", "76ERS", "SIXERS",
        // NFL
        "PACKERS", "BEARS", "LIONS", "VIKINGS", "COWBOYS", "GIANTS", "EAGLES",
        "COMMANDERS", "BUCCANEERS", "SAINTS", "FALCONS", "PANTHERS", "RAMS",
        "SEAHAWKS", "49ERS", "NINERS", "CARDINALS", "RAVENS", "BENGALS",
        "BROWNS", "STEELERS", "TEXANS", "COLTS", "JAGUARS", "TITANS", "BRONCOS",
        "CHIEFS", "RAIDERS", "CHARGERS", "BILLS", "DOLPHINS", "PATRIOTS", "JETS",
        // NHL
        "BRUINS", "SABRES", "RED WINGS", "BLACKHAWKS", "AVALANCHE", "BLUE JACKETS",
        "WILD", "PREDATORS", "BLUES", "FLAMES", "OILERS", "CANUCKS", "DUCKS",
        "COYOTES", "GOLDEN KNIGHTS", "KRAKEN", "SHARKS", "HURRICANES", "LIGHTNING",
        "CAPITALS", "FLYERS", "PENGUINS", "RANGERS", "ISLANDERS", "DEVILS",
        "MAPLE LEAFS", "SENATORS", "CANADIENS",
        // MLB
        "RED SOX", "YANKEES", "ORIOLES", "RAYS", "WHITE SOX", "GUARDIANS",
        "TIGERS", "ROYALS", "TWINS", "ASTROS", "ANGELS", "ATHLETICS", "MARINERS",
        "BRAVES", "MARLINS", "METS", "PHILLIES", "NATIONALS", "CUBS", "REDS",
        "BREWERS", "PIRATES", "DIAMONDBACKS", "ROCKIES", "DODGERS", "PADRES",
    ];

    for suffix in &suffixes {
        if let Some(pos) = s.rfind(suffix) {
            let before = &s[..pos].trim_end();
            if !before.is_empty() {
                s = before.to_string();
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
    // Find the YYMMMDD pattern after a dash
    let _re_pattern: Vec<u8> = ticker.bytes().collect();
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

pub type MarketIndex = HashMap<MarketKey, IndexedMarket>;

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
}
