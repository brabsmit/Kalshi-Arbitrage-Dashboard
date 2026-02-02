use chrono::NaiveDate;
use std::collections::HashMap;

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
    pub status: String,
    pub close_time: Option<String>,
}

/// Both sides of a game stored in the index.
/// Kalshi creates two markets per game: one for each team winning.
#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
pub struct IndexedGame {
    pub away: Option<SideMarket>,
    pub home: Option<SideMarket>,
    pub draw: Option<SideMarket>,
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

/// Look up a team's canonical Kalshi ticker code by sport and name.
/// Returns None if the team/sport isn't in the lookup tables (falls back to suffix-stripping).
fn team_code(sport: &str, name: &str) -> Option<&'static str> {
    let upper = name.to_uppercase();
    let upper = upper.trim();
    let sport_norm: String = sport
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .collect();
    match sport_norm.as_str() {
        "BASKETBALL" => nba_team_code(upper),
        "ICEHOCKEY" => nhl_team_code(upper),
        "SOCCEREPL" => epl_team_code(upper),
        _ => None,
    }
}

fn nba_team_code(name: &str) -> Option<&'static str> {
    match name {
        "ATLANTA HAWKS" | "ATLANTA" => Some("ATL"),
        "BOSTON CELTICS" | "BOSTON" => Some("BOS"),
        "BROOKLYN NETS" | "BROOKLYN" => Some("BKN"),
        "CHARLOTTE HORNETS" | "CHARLOTTE" => Some("CHA"),
        "CHICAGO BULLS" | "CHICAGO" => Some("CHI"),
        "CLEVELAND CAVALIERS" | "CLEVELAND" => Some("CLE"),
        "DALLAS MAVERICKS" | "DALLAS" => Some("DAL"),
        "DENVER NUGGETS" | "DENVER" => Some("DEN"),
        "DETROIT PISTONS" | "DETROIT" => Some("DET"),
        "GOLDEN STATE WARRIORS" | "GOLDEN STATE" => Some("GSW"),
        "HOUSTON ROCKETS" | "HOUSTON" => Some("HOU"),
        "INDIANA PACERS" | "INDIANA" => Some("IND"),
        "LOS ANGELES CLIPPERS" | "LOS ANGELES C" | "LA CLIPPERS" => Some("LAC"),
        "LOS ANGELES LAKERS" | "LOS ANGELES L" | "LA LAKERS" => Some("LAL"),
        "MEMPHIS GRIZZLIES" | "MEMPHIS" => Some("MEM"),
        "MIAMI HEAT" | "MIAMI" => Some("MIA"),
        "MILWAUKEE BUCKS" | "MILWAUKEE" => Some("MIL"),
        "MINNESOTA TIMBERWOLVES" | "MINNESOTA" => Some("MIN"),
        "NEW ORLEANS PELICANS" | "NEW ORLEANS" => Some("NOP"),
        "NEW YORK KNICKS" | "NEW YORK" => Some("NYK"),
        "OKLAHOMA CITY THUNDER" | "OKLAHOMA CITY" => Some("OKC"),
        "ORLANDO MAGIC" | "ORLANDO" => Some("ORL"),
        "PHILADELPHIA 76ERS" | "PHILADELPHIA SIXERS" | "PHILADELPHIA" => Some("PHI"),
        "PHOENIX SUNS" | "PHOENIX" => Some("PHX"),
        "PORTLAND TRAIL BLAZERS" | "PORTLAND" => Some("POR"),
        "SACRAMENTO KINGS" | "SACRAMENTO" => Some("SAC"),
        "SAN ANTONIO SPURS" | "SAN ANTONIO" => Some("SAS"),
        "TORONTO RAPTORS" | "TORONTO" => Some("TOR"),
        "UTAH JAZZ" | "UTAH" => Some("UTA"),
        "WASHINGTON WIZARDS" | "WASHINGTON" => Some("WAS"),
        _ => None,
    }
}

fn nhl_team_code(name: &str) -> Option<&'static str> {
    match name {
        "ANAHEIM DUCKS" | "ANAHEIM" => Some("ANA"),
        "ARIZONA COYOTES" | "ARIZONA" => Some("ARI"),
        "BOSTON BRUINS" => Some("BOS"),
        "BUFFALO SABRES" | "BUFFALO" => Some("BUF"),
        "CALGARY FLAMES" | "CALGARY" => Some("CGY"),
        "CAROLINA HURRICANES" | "CAROLINA" => Some("CAR"),
        "CHICAGO BLACKHAWKS" => Some("CHI"),
        "COLORADO AVALANCHE" | "COLORADO" => Some("COL"),
        "COLUMBUS BLUE JACKETS" | "COLUMBUS" => Some("CBJ"),
        "DALLAS STARS" => Some("DAL"),
        "DETROIT RED WINGS" => Some("DET"),
        "EDMONTON OILERS" | "EDMONTON" => Some("EDM"),
        "FLORIDA PANTHERS" | "FLORIDA" => Some("FLA"),
        "LOS ANGELES KINGS" | "LOS ANGELES" | "LA KINGS" => Some("LA"),
        "MINNESOTA WILD" => Some("MIN"),
        "MONTREAL CANADIENS" | "MONTREAL" => Some("MTL"),
        "NASHVILLE PREDATORS" | "NASHVILLE" => Some("NSH"),
        "NEW JERSEY DEVILS" | "NEW JERSEY" => Some("NJ"),
        "NEW YORK ISLANDERS" | "NEW YORK I" | "NY ISLANDERS" => Some("NYI"),
        "NEW YORK RANGERS" | "NEW YORK R" | "NY RANGERS" => Some("NYR"),
        "OTTAWA SENATORS" | "OTTAWA" => Some("OTT"),
        "PHILADELPHIA FLYERS" => Some("PHI"),
        "PITTSBURGH PENGUINS" | "PITTSBURGH" => Some("PIT"),
        "SAN JOSE SHARKS" | "SAN JOSE" => Some("SJ"),
        "SEATTLE KRAKEN" | "SEATTLE" => Some("SEA"),
        "ST LOUIS BLUES" | "ST. LOUIS BLUES" | "ST LOUIS" | "ST. LOUIS" => Some("STL"),
        "TAMPA BAY LIGHTNING" | "TAMPA BAY" => Some("TB"),
        "TORONTO MAPLE LEAFS" => Some("TOR"),
        "UTAH HOCKEY CLUB" => Some("UTA"),
        "VANCOUVER CANUCKS" | "VANCOUVER" => Some("VAN"),
        "VEGAS GOLDEN KNIGHTS" | "VEGAS" => Some("VGK"),
        "WASHINGTON CAPITALS" | "WASHINGTON" => Some("WSH"),
        "WINNIPEG JETS" | "WINNIPEG" => Some("WPG"),
        _ => None,
    }
}

fn epl_team_code(name: &str) -> Option<&'static str> {
    match name {
        "ARSENAL" => Some("ARS"),
        "ASTON VILLA" => Some("AVL"),
        "AFC BOURNEMOUTH" | "BOURNEMOUTH" => Some("BOU"),
        "BRENTFORD" => Some("BRE"),
        "BRIGHTON AND HOVE ALBION" | "BRIGHTON" => Some("BHA"),
        "BURNLEY" => Some("BUR"),
        "CHELSEA" => Some("CHE"),
        "CRYSTAL PALACE" => Some("CRY"),
        "EVERTON" => Some("EVE"),
        "FULHAM" => Some("FUL"),
        "IPSWICH TOWN" | "IPSWICH" => Some("IPS"),
        "LEEDS UNITED" => Some("LEE"),
        "LEICESTER CITY" | "LEICESTER" => Some("LEI"),
        "LIVERPOOL" => Some("LIV"),
        "MANCHESTER CITY" => Some("MCI"),
        "MANCHESTER UNITED" => Some("MUN"),
        "NEWCASTLE UNITED" | "NEWCASTLE" => Some("NEW"),
        "NOTTINGHAM FOREST" | "NOTTINGHAM" => Some("NFO"),
        "SUNDERLAND" => Some("SUN"),
        "TOTTENHAM HOTSPUR" | "TOTTENHAM" => Some("TOT"),
        "WEST HAM UNITED" | "WEST HAM" => Some("WHU"),
        "WOLVERHAMPTON WANDERERS" | "WOLVERHAMPTON" | "WOLVES" => Some("WOL"),
        _ => None,
    }
}

/// Normalizes a team name to a canonical key for market matching.
/// First checks per-sport lookup tables (NBA, NHL, EPL) for exact team codes.
/// Falls back to suffix-stripping for sports without lookup tables (college, MMA).
pub fn normalize_team(sport: &str, name: &str) -> String {
    // Try per-sport lookup first
    if let Some(code) = team_code(sport, name) {
        return code.to_string();
    }

    // Fallback: suffix-stripping normalization (college, MMA, unknown teams)
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
        "MAVERICKS",
        "JAZZ",
        "HAWKS",
        "CELTICS",
        "PISTONS",
        "PACERS",
        "HEAT",
        "THUNDER",
        "WARRIORS",
        "SUNS",
        "LAKERS",
        "CLIPPERS",
        "BLAZERS",
        "KINGS",
        "SPURS",
        "GRIZZLIES",
        "PELICANS",
        "ROCKETS",
        "TIMBERWOLVES",
        "NUGGETS",
        "BUCKS",
        "BULLS",
        "CAVALIERS",
        "RAPTORS",
        "NETS",
        "KNICKS",
        "WIZARDS",
        "HORNETS",
        "MAGIC",
        "TRAIL BLAZERS",
        "76ERS",
        "SIXERS",
        "CAVS",
        // NFL
        "PACKERS",
        "BEARS",
        "LIONS",
        "VIKINGS",
        "COWBOYS",
        "GIANTS",
        "EAGLES",
        "COMMANDERS",
        "REDSKINS",
        "BUCCANEERS",
        "SAINTS",
        "FALCONS",
        "PANTHERS",
        "RAMS",
        "SEAHAWKS",
        "49ERS",
        "NINERS",
        "CARDINALS",
        "RAVENS",
        "BENGALS",
        "BROWNS",
        "STEELERS",
        "TEXANS",
        "COLTS",
        "JAGUARS",
        "TITANS",
        "BRONCOS",
        "CHIEFS",
        "RAIDERS",
        "CHARGERS",
        "BILLS",
        "DOLPHINS",
        "PATRIOTS",
        "JETS",
        // NHL
        "BRUINS",
        "SABRES",
        "RED WINGS",
        "BLACKHAWKS",
        "AVALANCHE",
        "BLUE JACKETS",
        "WILD",
        "PREDATORS",
        "BLUES",
        "FLAMES",
        "OILERS",
        "CANUCKS",
        "DUCKS",
        "COYOTES",
        "GOLDEN KNIGHTS",
        "KRAKEN",
        "SHARKS",
        "HURRICANES",
        "LIGHTNING",
        "CAPITALS",
        "FLYERS",
        "PENGUINS",
        "RANGERS",
        "ISLANDERS",
        "DEVILS",
        "MAPLE LEAFS",
        "SENATORS",
        "CANADIENS",
        // MLB
        "RED SOX",
        "YANKEES",
        "ORIOLES",
        "RAYS",
        "WHITE SOX",
        "INDIANS",
        "GUARDIANS",
        "TIGERS",
        "ROYALS",
        "TWINS",
        "ASTROS",
        "ANGELS",
        "ATHLETICS",
        "MARINERS",
        "BRAVES",
        "MARLINS",
        "METS",
        "PHILLIES",
        "NATIONALS",
        "CUBS",
        "REDS",
        "BREWERS",
        "PIRATES",
        "DIAMONDBACKS",
        "ROCKIES",
        "DODGERS",
        "PADRES",
        // College – power conferences
        "AGGIES",
        "WILDCATS",
        "BULLDOGS",
        "CRIMSON TIDE",
        "VOLUNTEERS",
        "GATORS",
        "GAMECOCKS",
        "RAZORBACKS",
        "LONGHORNS",
        "SOONERS",
        "JAYHAWKS",
        "CYCLONES",
        "MOUNTAINEERS",
        "HUSKIES",
        "TROJANS",
        "CARDINAL",
        "SUN DEVILS",
        "GOLDEN BEARS",
        "BEAVERS",
        "COUGARS",
        "UTES",
        "BUFFALOES",
        "CORNHUSKERS",
        "BADGERS",
        "HAWKEYES",
        "SPARTANS",
        "WOLVERINES",
        "BUCKEYES",
        "NITTANY LIONS",
        "TERRAPINS",
        "SCARLET KNIGHTS",
        "HOOSIERS",
        "FIGHTING IRISH",
        "BLUE DEVILS",
        "TAR HEELS",
        "ORANGE",
        "DEMON DEACONS",
        "YELLOW JACKETS",
        "SEMINOLES",
        "ORANGEMEN",
        "WOLFPACK",
        "HOKIES",
        "MUSTANGS",
        "BEARCATS",
        "HORNED FROGS",
        "RED RAIDERS",
        "KNIGHTS",
        "BLUEJAYS",
        "BLUE DEMONS",
        "HOYAS",
        "GOLDEN EAGLES",
        "FRIARS",
        "RED STORM",
        "MUSKETEERS",
        "FIGHTING ILLINI",
        "GOLDEN GOPHERS",
        "BOILERMAKERS",
        "REBELS",
        "COMMODORES",
        "OWLS",
        // College – mid-majors
        "AZTECS",
        "LOBOS",
        "SHOCKERS",
        "MIDSHIPMEN",
        "GREEN WAVE",
        "GOLDEN HURRICANE",
        "ROADRUNNERS",
        "MEAN GREEN",
        "GAELS",
        "DUKES",
        "BILLIKENS",
        "SPIDERS",
        "RAMBLERS",
        "MINUTEMEN",
        "EXPLORERS",
        "BONNIES",
        "WAVES",
        "PILOTS",
        "TOREROS",
        "DONS",
        "BOBCATS",
        "PEACOCKS",
        "CATAMOUNTS",
        "COLONIALS",
        "WOLF PACK",
        // College – smaller conferences
        "TERRIERS",
        "BISON",
        "CRUSADERS",
        "LEOPARDS",
        "BLACK KNIGHTS",
        "PHOENIX",
        "SEAWOLVES",
        "DRAGONS",
        "BLUE HENS",
        "FIGHTING CAMELS",
        "SYCAMORES",
        "BEACONS",
        "MASTODONS",
        "SALUKIS",
        "RACERS",
        "SKYHAWKS",
        "LUMBERJACKS",
        "COLONELS",
        "CHANTICLEERS",
        "THUNDERING HERD",
        "REDHAWKS",
        "MONARCHS",
        "VANDALS",
        "CRIMSON",
        "QUAKERS",
        "ANTEATERS",
        "GAUCHOS",
        "MOCS",
        "PALADINS",
        "KEYDETS",
        "STAGS",
        "JASPERS",
        "RED FOXES",
        "PURPLE EAGLES",
        "BRONCS",
        "GOLDEN GRIFFINS",
        "PURPLE ACES",
        "REDBIRDS",
        "NORSE",
        "GOLDEN GRIZZLIES",
        "MOUNTAIN HAWKS",
        "GREYHOUNDS",
        "PRIDE",
        "TRIBE",
        "PIONEERS",
        "JACKRABBITS",
        "RED WOLVES",
        "WARHAWKS",
        "RAGIN CAJUNS",
        "THUNDERBIRDS",
        "LANCERS",
        "ANTELOPES",
        "GOVERNORS",
        "OSPREYS",
        "HATTERS",
        "MATADORS",
        "HIGHLANDERS",
        "TRITONS",
        "BIG RED",
        "BIG GREEN",
        "RATTLERS",
        "DELTA DEVILS",
        "PRIVATEERS",
        "DEMONS",
        "SCREAMING EAGLES",
        "LEATHERNECKS",
        "TRAILBLAZERS",
        "RAINBOW WARRIORS",
    ];

    // Find the longest matching suffix so multi-word mascots (e.g. "GOLDEN EAGLES")
    // always win over shorter pro entries (e.g. "EAGLES") regardless of list order.
    let mut best_stripped: Option<String> = None;
    let mut best_len = 0;
    for suffix in &suffixes {
        if let Some(stripped) = s.strip_suffix(suffix) {
            let stripped = stripped.trim_end();
            if !stripped.is_empty() && suffix.len() > best_len {
                best_stripped = Some(stripped.to_string());
                best_len = suffix.len();
            }
        }
    }
    if let Some(m) = best_stripped {
        s = m;
    }

    // Remove all spaces and non-alphanumeric
    s.retain(|c| c.is_ascii_alphanumeric());
    s.truncate(20);
    s
}

/// Generate a deterministic market key.
pub fn generate_key(sport: &str, team1: &str, team2: &str, date: NaiveDate) -> Option<MarketKey> {
    let n1 = normalize_team(sport, team1);
    let n2 = normalize_team(sport, team2);
    if n1.is_empty() || n2.is_empty() {
        return None;
    }
    let mut teams = [n1, n2];
    teams.sort();
    Some(MarketKey {
        sport: sport
            .to_uppercase()
            .chars()
            .filter(|c| c.is_ascii_alphabetic())
            .collect(),
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
                    "JAN" => Some(1),
                    "FEB" => Some(2),
                    "MAR" => Some(3),
                    "APR" => Some(4),
                    "MAY" => Some(5),
                    "JUN" => Some(6),
                    "JUL" => Some(7),
                    "AUG" => Some(8),
                    "SEP" => Some(9),
                    "OCT" => Some(10),
                    "NOV" => Some(11),
                    "DEC" => Some(12),
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

/// Parse UFC/MMA title to extract fighter names from the event portion.
/// Title format: "Will X win the Fighter1 vs Fighter2 professional MMA fight scheduled for ..."
/// Returns (fighter1, fighter2) from the event portion.
pub fn parse_ufc_title(title: &str) -> Option<(String, String)> {
    let start = title.find("win the ")? + 8;
    let end = title.find(" professional MMA fight")?;
    if start >= end {
        return None;
    }
    let event_part = &title[start..end];
    let (f1, f2) = event_part.split_once(" vs ")?;
    Some((f1.to_string(), f2.to_string()))
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
        // With lookup tables, NBA teams return ticker codes
        assert_eq!(normalize_team("basketball", "Dallas Mavericks"), "DAL");
        assert_eq!(normalize_team("basketball", "Los Angeles Lakers"), "LAL");
        assert_eq!(normalize_team("basketball", "New York Knicks"), "NYK");
        assert_eq!(normalize_team("basketball", "Oklahoma City Thunder"), "OKC");
    }

    #[test]
    fn test_generate_key_sorted() {
        let d = NaiveDate::from_ymd_opt(2026, 1, 19).unwrap();
        let k1 = generate_key("basketball", "Los Angeles Lakers", "Boston Celtics", d).unwrap();
        let k2 = generate_key("basketball", "Boston Celtics", "Los Angeles Lakers", d).unwrap();
        assert_eq!(k1, k2); // same regardless of order
    }

    #[test]
    fn test_parse_date_from_ticker() {
        let d = parse_date_from_ticker("KXNBAGAME-26JAN19LACWAS").unwrap();
        assert_eq!(d, NaiveDate::from_ymd_opt(2026, 1, 19).unwrap());
    }

    #[test]
    fn test_parse_kalshi_title() {
        let (away, home) =
            parse_kalshi_title("Dallas Mavericks at Los Angeles Lakers Winner?").unwrap();
        assert_eq!(away, "Dallas Mavericks");
        assert_eq!(home, "Los Angeles Lakers");
    }

    #[test]
    fn test_is_away_market() {
        // IND in "Indiana Pacers" → away
        assert_eq!(
            is_away_market(
                "KXNBAGAME-26JAN19INDPHI-IND",
                "Indiana Pacers",
                "Philadelphia 76ers"
            ),
            Some(true)
        );
        // PHI in "Philadelphia 76ers" → home
        assert_eq!(
            is_away_market(
                "KXNBAGAME-26JAN19INDPHI-PHI",
                "Indiana Pacers",
                "Philadelphia 76ers"
            ),
            Some(false)
        );
        // Multi-word city abbreviations (LAC) resolved via ticker segment
        assert_eq!(
            is_away_market(
                "KXNBAGAME-26JAN19LACWAS-LAC",
                "Los Angeles Clippers",
                "Washington Wizards"
            ),
            Some(true),
        );
    }

    #[test]
    fn test_is_away_market_from_ticker_segment() {
        // LAC appears first in "LACWAS" = away, winner code "LAC" = away market
        assert_eq!(
            is_away_market(
                "KXNBAGAME-26JAN19LACWAS-LAC",
                "Los Angeles Clippers",
                "Washington Wizards"
            ),
            Some(true),
        );
        // WAS appears second in "LACWAS" = home, winner code "WAS" = home market
        assert_eq!(
            is_away_market(
                "KXNBAGAME-26JAN19LACWAS-WAS",
                "Los Angeles Clippers",
                "Washington Wizards"
            ),
            Some(false),
        );
    }

    #[test]
    fn test_parse_ufc_title() {
        let result = parse_ufc_title(
            "Will Alex Volkanovski win the Volkanovski vs Lopes professional MMA fight scheduled for Jan 31, 2026?"
        );
        assert_eq!(
            result,
            Some(("Volkanovski".to_string(), "Lopes".to_string()))
        );
    }

    #[test]
    fn test_parse_ufc_title_hyphenated() {
        let result = parse_ufc_title(
            "Will Benoit Saint-Denis win the Hooker vs Saint-Denis professional MMA fight scheduled for Jan 31, 2026?"
        );
        assert_eq!(
            result,
            Some(("Hooker".to_string(), "Saint-Denis".to_string()))
        );
    }

    #[test]
    fn test_parse_ufc_title_not_ufc() {
        let result = parse_ufc_title("Dallas Mavericks at Los Angeles Lakers Winner?");
        assert_eq!(result, None);
    }

    #[test]
    fn test_side_market_carries_status_and_close_time() {
        let sm = SideMarket {
            ticker: "KXNBAGAME-26JAN19LACWAS-LAC".to_string(),
            title: "Test".to_string(),
            yes_bid: 50,
            yes_ask: 55,
            no_bid: 45,
            no_ask: 50,
            status: "open".to_string(),
            close_time: Some("2026-01-20T04:00:00Z".to_string()),
        };
        assert_eq!(sm.status, "open");
        assert_eq!(sm.close_time.as_deref(), Some("2026-01-20T04:00:00Z"));
    }

    #[test]
    fn test_team_code_nba_full_names() {
        assert_eq!(team_code("basketball", "Los Angeles Lakers"), Some("LAL"));
        assert_eq!(team_code("basketball", "Los Angeles Clippers"), Some("LAC"));
        assert_eq!(
            team_code("basketball", "Portland Trail Blazers"),
            Some("POR")
        );
        assert_eq!(
            team_code("basketball", "Golden State Warriors"),
            Some("GSW")
        );
        assert_eq!(team_code("basketball", "New York Knicks"), Some("NYK"));
        assert_eq!(team_code("basketball", "Brooklyn Nets"), Some("BKN"));
        assert_eq!(
            team_code("basketball", "Oklahoma City Thunder"),
            Some("OKC")
        );
        assert_eq!(team_code("basketball", "New Orleans Pelicans"), Some("NOP"));
    }

    #[test]
    fn test_team_code_nba_kalshi_abbreviated() {
        assert_eq!(team_code("basketball", "Los Angeles L"), Some("LAL"));
        assert_eq!(team_code("basketball", "Los Angeles C"), Some("LAC"));
        assert_eq!(team_code("basketball", "Portland"), Some("POR"));
        assert_eq!(team_code("basketball", "Golden State"), Some("GSW"));
        assert_eq!(team_code("basketball", "New York"), Some("NYK"));
        assert_eq!(team_code("basketball", "New Orleans"), Some("NOP"));
        assert_eq!(team_code("basketball", "Oklahoma City"), Some("OKC"));
    }

    #[test]
    fn test_team_code_nhl_disambiguation() {
        assert_eq!(team_code("ice-hockey", "New York Rangers"), Some("NYR"));
        assert_eq!(team_code("ice-hockey", "New York Islanders"), Some("NYI"));
        assert_eq!(team_code("ice-hockey", "New York R"), Some("NYR"));
        assert_eq!(team_code("ice-hockey", "New York I"), Some("NYI"));
        assert_eq!(team_code("ice-hockey", "Los Angeles Kings"), Some("LA"));
        assert_eq!(team_code("ice-hockey", "Los Angeles"), Some("LA"));
        assert_eq!(team_code("ice-hockey", "Washington Capitals"), Some("WSH"));
    }

    #[test]
    fn test_team_code_epl() {
        assert_eq!(team_code("soccer-epl", "Tottenham Hotspur"), Some("TOT"));
        assert_eq!(team_code("soccer-epl", "Tottenham"), Some("TOT"));
        assert_eq!(team_code("soccer-epl", "Manchester United"), Some("MUN"));
        assert_eq!(team_code("soccer-epl", "Manchester City"), Some("MCI"));
        assert_eq!(team_code("soccer-epl", "Nottingham Forest"), Some("NFO"));
        assert_eq!(team_code("soccer-epl", "Nottingham"), Some("NFO"));
    }

    #[test]
    fn test_normalize_college_suffix_stripping() {
        let s = "college-basketball";
        // Power conference mascots
        assert_eq!(normalize_team(s, "Duke Blue Devils"), "DUKE");
        assert_eq!(normalize_team(s, "Virginia Tech Hokies"), "VIRGINIATECH");
        assert_eq!(normalize_team(s, "NC State Wolfpack"), "NCSTATE");
        assert_eq!(normalize_team(s, "Texas Tech Red Raiders"), "TEXASTECH");
        assert_eq!(normalize_team(s, "Cincinnati Bearcats"), "CINCINNATI");
        assert_eq!(normalize_team(s, "Purdue Boilermakers"), "PURDUE");
        assert_eq!(normalize_team(s, "Illinois Fighting Illini"), "ILLINOIS");
        assert_eq!(normalize_team(s, "Minnesota Golden Gophers"), "MINNESOTA");
        assert_eq!(normalize_team(s, "TCU Horned Frogs"), "TCU");
        assert_eq!(normalize_team(s, "Georgetown Hoyas"), "GEORGETOWN");
        assert_eq!(normalize_team(s, "Xavier Musketeers"), "XAVIER");
        assert_eq!(normalize_team(s, "DePaul Blue Demons"), "DEPAUL");
        assert_eq!(normalize_team(s, "Creighton Bluejays"), "CREIGHTON");
        assert_eq!(normalize_team(s, "Providence Friars"), "PROVIDENCE");
        assert_eq!(normalize_team(s, "UCF Knights"), "UCF");
        assert_eq!(normalize_team(s, "Ole Miss Rebels"), "OLEMISS");
        assert_eq!(normalize_team(s, "Vanderbilt Commodores"), "VANDERBILT");
        // Mid-major mascots
        assert_eq!(normalize_team(s, "San Diego State Aztecs"), "SANDIEGOSTATE");
        assert_eq!(normalize_team(s, "Wichita State Shockers"), "WICHITASTATE");
        assert_eq!(normalize_team(s, "Saint Peter's Peacocks"), "STPETERS");
        assert_eq!(
            normalize_team(s, "Western Carolina Catamounts"),
            "WESTERNCAROLINA"
        );
        // Smaller conference mascots
        assert_eq!(normalize_team(s, "Army Black Knights"), "ARMY");
        assert_eq!(normalize_team(s, "Holy Cross Crusaders"), "HOLYCROSS");
        assert_eq!(normalize_team(s, "Bucknell Bison"), "BUCKNELL");
        assert_eq!(normalize_team(s, "Stony Brook Seawolves"), "STONYBROOK");
        assert_eq!(normalize_team(s, "Elon Phoenix"), "ELON");
        assert_eq!(normalize_team(s, "Indiana State Sycamores"), "INDIANASTATE");
        assert_eq!(normalize_team(s, "Valparaiso Beacons"), "VALPARAISO");
    }

    #[test]
    fn test_longest_suffix_wins() {
        let s = "college-basketball";
        // "GOLDEN EAGLES" must beat "EAGLES" (NFL entry)
        assert_eq!(normalize_team(s, "Marquette Golden Eagles"), "MARQUETTE");
        // "BLACK KNIGHTS" must beat "KNIGHTS"
        assert_eq!(normalize_team(s, "Army Black Knights"), "ARMY");
        // "GOLDEN GRIZZLIES" must beat "GRIZZLIES" (NBA entry)
        assert_eq!(normalize_team(s, "Oakland Golden Grizzlies"), "OAKLAND");
        // "PURPLE EAGLES" must beat "EAGLES"
        assert_eq!(normalize_team(s, "Niagara Purple Eagles"), "NIAGARA");
        // "MOUNTAIN HAWKS" must beat "HAWKS" (NBA entry)
        assert_eq!(normalize_team(s, "Lehigh Mountain Hawks"), "LEHIGH");
        // "RED RAIDERS" must beat "RAIDERS" (NFL entry)
        assert_eq!(normalize_team(s, "Texas Tech Red Raiders"), "TEXASTECH");
        // "SCREAMING EAGLES" must beat "EAGLES"
        assert_eq!(
            normalize_team(s, "Southern Indiana Screaming Eagles"),
            "SOUTHERNINDIANA"
        );
        // "DELTA DEVILS" must beat "DEVILS" (NHL entry)
        assert_eq!(
            normalize_team(s, "Mississippi Valley State Delta Devils"),
            "MISSISSIPPIVALLEYSTA"
        );
        // "RAINBOW WARRIORS" must beat "WARRIORS" (NBA entry)
        assert_eq!(normalize_team(s, "Hawaii Rainbow Warriors"), "HAWAII");
    }

    #[test]
    fn test_college_cross_source_matching() {
        let s = "college-basketball";
        let d = NaiveDate::from_ymd_opt(2026, 1, 31).unwrap();
        // Polymarket full names should match Kalshi location-only names
        let k_poly = generate_key(s, "Duke Blue Devils", "Virginia Tech Hokies", d).unwrap();
        let k_kalshi = generate_key(s, "Duke", "Virginia Tech", d).unwrap();
        assert_eq!(k_poly, k_kalshi);

        let k_poly = generate_key(s, "Marquette Golden Eagles", "Seton Hall Pirates", d).unwrap();
        let k_kalshi = generate_key(s, "Marquette", "Seton Hall", d).unwrap();
        assert_eq!(k_poly, k_kalshi);

        let k_poly = generate_key(s, "Texas Tech Red Raiders", "UCF Knights", d).unwrap();
        let k_kalshi = generate_key(s, "Texas Tech", "UCF", d).unwrap();
        assert_eq!(k_poly, k_kalshi);
    }

    #[test]
    fn test_team_code_fallback_unknown() {
        assert_eq!(team_code("basketball", "Nonexistent Team"), None);
        assert_eq!(team_code("unknown-sport", "Boston Celtics"), None);
        assert_eq!(team_code("college-basketball", "Duke Blue Devils"), None);
    }

    #[test]
    fn test_normalize_team_cross_source_matching() {
        // Odds API full name and Kalshi abbreviated name must produce same output
        let sport = "basketball";
        assert_eq!(
            normalize_team(sport, "Los Angeles Lakers"),
            normalize_team(sport, "Los Angeles L")
        );
        assert_eq!(
            normalize_team(sport, "Los Angeles Clippers"),
            normalize_team(sport, "Los Angeles C")
        );
        assert_eq!(
            normalize_team(sport, "Portland Trail Blazers"),
            normalize_team(sport, "Portland")
        );

        // NHL disambiguation
        let sport = "ice-hockey";
        assert_eq!(
            normalize_team(sport, "New York Rangers"),
            normalize_team(sport, "New York R")
        );
        assert_eq!(
            normalize_team(sport, "New York Islanders"),
            normalize_team(sport, "New York I")
        );
        // NHL Rangers != Islanders
        assert_ne!(
            normalize_team(sport, "New York Rangers"),
            normalize_team(sport, "New York Islanders")
        );
    }

    #[test]
    fn test_generate_key_cross_source() {
        let d = NaiveDate::from_ymd_opt(2026, 1, 30).unwrap();
        // Odds API: "Los Angeles Lakers" vs Kalshi title: "Los Angeles L" — must produce same key
        let k_odds =
            generate_key("basketball", "Los Angeles Lakers", "Washington Wizards", d).unwrap();
        let k_kalshi = generate_key("basketball", "Los Angeles L", "Washington", d).unwrap();
        assert_eq!(k_odds, k_kalshi);

        // Lakers and Clippers must NOT collide
        let k_lakers =
            generate_key("basketball", "Los Angeles Lakers", "Washington Wizards", d).unwrap();
        let k_clippers =
            generate_key("basketball", "Los Angeles Clippers", "Denver Nuggets", d).unwrap();
        assert_ne!(k_lakers, k_clippers);
    }
}
