use serde::Deserialize;

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
    pub home_odds: f64,
    pub away_odds: f64,
    pub last_update: String,
}

/// odds-api.io REST response types
#[derive(Debug, Deserialize)]
pub struct OddsApiEvent {
    pub id: String,
    pub sport_key: String,
    pub home_team: String,
    pub away_team: String,
    pub commence_time: String,
    pub bookmakers: Vec<OddsApiBookmaker>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct OddsApiBookmaker {
    pub key: String,
    pub title: String,
    pub last_update: String,
    pub markets: Vec<OddsApiMarket>,
}

#[derive(Debug, Deserialize)]
pub struct OddsApiMarket {
    pub key: String,
    pub outcomes: Vec<OddsApiOutcome>,
}

#[derive(Debug, Deserialize)]
pub struct OddsApiOutcome {
    pub name: String,
    pub price: f64,
}
