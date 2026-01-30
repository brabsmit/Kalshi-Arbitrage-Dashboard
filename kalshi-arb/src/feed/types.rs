use serde::Deserialize;

/// Normalized internal types used by the engine (provider-agnostic).

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct OddsUpdate {
    pub event_id: String,
    pub sport: String,
    pub home_team: String,
    pub away_team: String,
    pub commence_time: String,
    pub bookmakers: Vec<BookmakerOdds>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct BookmakerOdds {
    pub name: String,
    pub home_odds: f64,  // American odds
    pub away_odds: f64,  // American odds
    pub last_update: String,
}

/// the-odds-api.com v4 response: top-level array of events
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct TheOddsApiEvent {
    pub id: String,
    pub sport_key: String,
    pub home_team: String,
    pub away_team: String,
    pub commence_time: String,
    #[serde(default)]
    pub bookmakers: Vec<TheOddsApiBookmaker>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct TheOddsApiBookmaker {
    pub key: String,
    pub title: String,
    pub last_update: String,
    pub markets: Vec<TheOddsApiMarket>,
}

#[derive(Debug, Deserialize)]
pub struct TheOddsApiMarket {
    pub key: String,
    pub outcomes: Vec<TheOddsApiOutcome>,
}

#[derive(Debug, Deserialize)]
pub struct TheOddsApiOutcome {
    pub name: String,
    pub price: f64,
}
