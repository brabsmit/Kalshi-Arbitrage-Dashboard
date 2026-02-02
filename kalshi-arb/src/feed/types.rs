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
    pub home_odds: f64, // American odds
    pub away_odds: f64, // American odds
    pub draw_odds: Option<f64>,
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

/// API usage quota info extracted from response headers.
#[derive(Debug, Clone, Default)]
pub struct ApiQuota {
    pub requests_used: u64,
    pub requests_remaining: u64,
}

/// DraftKings sportsbook API response types.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DkResponse {
    pub event_group: Option<DkEventGroup>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DkEventGroup {
    #[serde(default)]
    pub events: Vec<DkEvent>,
    #[serde(default)]
    pub offer_categories: Vec<DkOfferCategory>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct DkEvent {
    pub event_id: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub start_date: String,
    #[serde(default)]
    pub team_name1: Option<String>,
    #[serde(default)]
    pub team_name2: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct DkOfferCategory {
    #[serde(default)]
    pub offer_category_id: u64,
    #[serde(default)]
    pub offers: Vec<Vec<DkOffer>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DkOffer {
    #[serde(default)]
    pub event_id: u64,
    #[serde(default)]
    pub outcomes: Vec<DkOutcome>,
    #[serde(default)]
    pub is_suspended: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DkOutcome {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub odds_american: String,
}
