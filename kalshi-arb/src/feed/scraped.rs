//! Bovada sportsbook odds feed via their public JSON API.
//!
//! Endpoint: /services/sports/event/coupon/events/A/description/{sport}/{league}
//! Returns structured JSON with events, competitors, and moneyline odds.

use super::types::*;
use super::OddsFeed;
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

const BOVADA_BASE: &str = "https://www.bovada.lv/services/sports/event/coupon/events/A/description";

/// Map internal sport key to Bovada URL path segment.
fn bovada_sport_path(sport: &str) -> Option<&'static str> {
    match sport {
        "college-basketball" | "college-basketball-womens" => Some("basketball/college-basketball"),
        "basketball" => Some("basketball/nba"),
        "ice-hockey" => Some("hockey/nhl"),
        "baseball" => Some("baseball/mlb"),
        "mma" => Some("martial-arts/mma"),
        _ => None,
    }
}

// ── Bovada JSON response types ────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BovadaResponse {
    #[serde(default)]
    pub events: Vec<BovadaEvent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BovadaEvent {
    pub id: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub start_time: i64,
    #[serde(default)]
    pub live: bool,
    #[serde(default)]
    pub competitors: Vec<BovadaCompetitor>,
    #[serde(default)]
    pub display_groups: Vec<BovadaDisplayGroup>,
}

#[derive(Debug, Deserialize)]
pub struct BovadaCompetitor {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub home: bool,
}

#[derive(Debug, Deserialize)]
pub struct BovadaDisplayGroup {
    #[serde(default)]
    pub markets: Vec<BovadaMarket>,
}

#[derive(Debug, Deserialize)]
pub struct BovadaMarket {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub outcomes: Vec<BovadaOutcome>,
}

#[derive(Debug, Deserialize)]
pub struct BovadaOutcome {
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub price: BovadaPrice,
}

#[derive(Debug, Deserialize, Default)]
pub struct BovadaPrice {
    #[serde(default)]
    pub american: String,
}

// ── Parsing ───────────────────────────────────────────────────────────

/// Parse American odds string from Bovada: "-150", "+130", "EVEN".
fn parse_american_odds(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.eq_ignore_ascii_case("EVEN") {
        return Some(100.0);
    }
    s.parse::<f64>().ok()
}

/// Parse Bovada JSON response into `Vec<OddsUpdate>`.
/// Public for unit testing with fixtures.
pub fn parse_bovada_response(json: &str, sport: &str) -> Result<Vec<OddsUpdate>> {
    // Bovada returns an array of path-sections; each has events.
    let sections: Vec<BovadaResponse> =
        serde_json::from_str(json).context("failed to parse Bovada JSON")?;

    let now = chrono::Utc::now().to_rfc3339();
    let mut updates = Vec::new();

    for section in &sections {
        for event in &section.events {
            let home = event.competitors.iter().find(|c| c.home);
            let away = event.competitors.iter().find(|c| !c.home);
            let (Some(home), Some(away)) = (home, away) else {
                continue;
            };

            // Find moneyline market (key "2W-12" = 2-way moneyline)
            let moneyline = event
                .display_groups
                .iter()
                .flat_map(|dg| &dg.markets)
                .find(|m| m.key == "2W-12");

            let Some(ml) = moneyline else { continue };
            if ml.outcomes.len() < 2 {
                continue;
            }

            let home_odds = ml
                .outcomes
                .iter()
                .find(|o| o.description == home.name)
                .and_then(|o| parse_american_odds(&o.price.american));
            let away_odds = ml
                .outcomes
                .iter()
                .find(|o| o.description == away.name)
                .and_then(|o| parse_american_odds(&o.price.american));

            let (Some(h), Some(a)) = (home_odds, away_odds) else {
                continue;
            };

            // Convert epoch millis to RFC3339
            let commence = chrono::DateTime::from_timestamp_millis(event.start_time)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default();

            updates.push(OddsUpdate {
                event_id: event.id.clone(),
                sport: sport.to_string(),
                home_team: home.name.clone(),
                away_team: away.name.clone(),
                commence_time: commence,
                bookmakers: vec![BookmakerOdds {
                    name: "Bovada".to_string(),
                    home_odds: h,
                    away_odds: a,
                    draw_odds: None,
                    last_update: now.clone(),
                }],
            });
        }
    }

    Ok(updates)
}

// ── OddsFeed implementation ──────────────────────────────────────────

pub struct ScrapedOddsFeed {
    client: Client,
    base_url: String,
    max_retries: u32,
    cached: Vec<OddsUpdate>,
}

impl ScrapedOddsFeed {
    pub fn new(base_url: &str, timeout_ms: u64, max_retries: u32) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .build()
            .expect("failed to build reqwest client");

        Self {
            client,
            base_url: base_url.to_string(),
            max_retries,
            cached: Vec::new(),
        }
    }

    fn build_url(&self, sport: &str) -> Option<String> {
        if self.base_url.starts_with("http") {
            // Full URL override from config
            Some(self.base_url.clone())
        } else {
            bovada_sport_path(sport).map(|path| format!("{}/{}", BOVADA_BASE, path))
        }
    }
}

#[async_trait]
impl OddsFeed for ScrapedOddsFeed {
    async fn fetch_odds(&mut self, sport: &str) -> Result<Vec<OddsUpdate>> {
        let url = self
            .build_url(sport)
            .with_context(|| format!("Bovada does not support sport: {}", sport))?;

        let mut last_err = None;
        for attempt in 0..=self.max_retries {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
            }

            match self.client.get(&url).send().await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        let status = resp.status();
                        let body = resp.text().await.unwrap_or_default();
                        last_err = Some(anyhow::anyhow!("Bovada HTTP {} : {}", status, body));
                        continue;
                    }
                    let text = resp.text().await.context("Bovada response read failed")?;
                    match parse_bovada_response(&text, sport) {
                        Ok(updates) if updates.is_empty() && !self.cached.is_empty() => {
                            tracing::warn!("Bovada returned 0 events, using cache");
                            return Ok(self.cached.clone());
                        }
                        Ok(updates) => {
                            self.cached = updates.clone();
                            return Ok(updates);
                        }
                        Err(e) => {
                            tracing::warn!(attempt, error = %e, "Bovada parse failed");
                            last_err = Some(e);
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(attempt, error = %e, "Bovada request failed");
                    last_err = Some(e.into());
                }
            }
        }

        // All retries exhausted — return cache if available
        if !self.cached.is_empty() {
            tracing::warn!("Bovada fetch exhausted retries, returning cached data");
            Ok(self.cached.clone())
        } else {
            Err(last_err.unwrap_or_else(|| anyhow::anyhow!("Bovada fetch failed")))
        }
    }

    fn last_quota(&self) -> Option<ApiQuota> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_american_odds_negative() {
        assert!((parse_american_odds("-150").unwrap() - (-150.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_american_odds_positive() {
        assert!((parse_american_odds("+130").unwrap() - 130.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_american_odds_even() {
        assert!((parse_american_odds("EVEN").unwrap() - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_american_odds_invalid() {
        assert!(parse_american_odds("").is_none());
        assert!(parse_american_odds("abc").is_none());
    }

    #[test]
    fn test_bovada_sport_path() {
        assert_eq!(
            bovada_sport_path("college-basketball"),
            Some("basketball/college-basketball")
        );
        assert_eq!(bovada_sport_path("basketball"), Some("basketball/nba"));
        assert_eq!(bovada_sport_path("curling"), None);
    }

    fn fixture_json() -> &'static str {
        r#"[{
            "path": [],
            "events": [
                {
                    "id": "21494924",
                    "description": "UC Riverside @ Boise State",
                    "startTime": 1738364400000,
                    "live": false,
                    "competitors": [
                        { "name": "Boise State", "home": true },
                        { "name": "UC Riverside", "home": false }
                    ],
                    "displayGroups": [{
                        "markets": [{
                            "key": "2W-12",
                            "outcomes": [
                                {
                                    "description": "Boise State",
                                    "price": { "american": "-3300" }
                                },
                                {
                                    "description": "UC Riverside",
                                    "price": { "american": "+1200" }
                                }
                            ]
                        }]
                    }]
                },
                {
                    "id": "21494925",
                    "description": "Duke @ North Carolina",
                    "startTime": 1738368000000,
                    "live": true,
                    "competitors": [
                        { "name": "North Carolina", "home": true },
                        { "name": "Duke", "home": false }
                    ],
                    "displayGroups": [{
                        "markets": [{
                            "key": "2W-12",
                            "outcomes": [
                                {
                                    "description": "North Carolina",
                                    "price": { "american": "+110" }
                                },
                                {
                                    "description": "Duke",
                                    "price": { "american": "-130" }
                                }
                            ]
                        }]
                    }]
                }
            ]
        }]"#
    }

    #[test]
    fn test_parse_bovada_response_basic() {
        let updates = parse_bovada_response(fixture_json(), "college-basketball").unwrap();
        assert_eq!(updates.len(), 2);
    }

    #[test]
    fn test_parse_bovada_response_teams() {
        let updates = parse_bovada_response(fixture_json(), "college-basketball").unwrap();
        let boise = &updates[0];
        assert_eq!(boise.home_team, "Boise State");
        assert_eq!(boise.away_team, "UC Riverside");
    }

    #[test]
    fn test_parse_bovada_response_odds() {
        let updates = parse_bovada_response(fixture_json(), "college-basketball").unwrap();
        let boise = &updates[0];
        let bm = &boise.bookmakers[0];
        assert_eq!(bm.name, "Bovada");
        assert!((bm.home_odds - (-3300.0)).abs() < f64::EPSILON);
        assert!((bm.away_odds - 1200.0).abs() < f64::EPSILON);
        assert!(bm.draw_odds.is_none());
    }

    #[test]
    fn test_parse_bovada_response_commence_time() {
        let updates = parse_bovada_response(fixture_json(), "college-basketball").unwrap();
        assert!(updates[0].commence_time.contains("2025-01-31"));
    }

    #[test]
    fn test_parse_bovada_response_sport() {
        let updates = parse_bovada_response(fixture_json(), "college-basketball").unwrap();
        assert_eq!(updates[0].sport, "college-basketball");
    }

    #[test]
    fn test_parse_bovada_response_event_id() {
        let updates = parse_bovada_response(fixture_json(), "college-basketball").unwrap();
        assert_eq!(updates[0].event_id, "21494924");
        assert_eq!(updates[1].event_id, "21494925");
    }

    #[test]
    fn test_parse_bovada_empty_events() {
        let json = r#"[{"path": [], "events": []}]"#;
        let updates = parse_bovada_response(json, "college-basketball").unwrap();
        assert!(updates.is_empty());
    }

    #[test]
    fn test_parse_bovada_missing_moneyline() {
        let json = r#"[{
            "path": [],
            "events": [{
                "id": "123",
                "description": "A @ B",
                "startTime": 1738364400000,
                "live": false,
                "competitors": [
                    { "name": "B", "home": true },
                    { "name": "A", "home": false }
                ],
                "displayGroups": [{
                    "markets": [{
                        "key": "SPREAD",
                        "outcomes": []
                    }]
                }]
            }]
        }]"#;
        let updates = parse_bovada_response(json, "college-basketball").unwrap();
        assert!(updates.is_empty());
    }

    #[test]
    fn test_parse_bovada_even_odds() {
        let json = r#"[{
            "path": [],
            "events": [{
                "id": "456",
                "description": "A @ B",
                "startTime": 1738364400000,
                "live": false,
                "competitors": [
                    { "name": "B", "home": true },
                    { "name": "A", "home": false }
                ],
                "displayGroups": [{
                    "markets": [{
                        "key": "2W-12",
                        "outcomes": [
                            { "description": "B", "price": { "american": "EVEN" } },
                            { "description": "A", "price": { "american": "EVEN" } }
                        ]
                    }]
                }]
            }]
        }]"#;
        let updates = parse_bovada_response(json, "college-basketball").unwrap();
        assert_eq!(updates.len(), 1);
        assert!((updates[0].bookmakers[0].home_odds - 100.0).abs() < f64::EPSILON);
    }

    /// Integration test: hits real Bovada API.
    /// Run with: cargo test bovada_live --ignored -- --nocapture
    #[tokio::test]
    #[ignore]
    async fn bovada_live_fetch() {
        let mut feed = ScrapedOddsFeed::new(
            "https://www.bovada.lv/services/sports/event/coupon/events/A/description/basketball/college-basketball",
            10000,
            2,
        );
        match feed.fetch_odds("college-basketball").await {
            Ok(updates) => {
                println!("Got {} NCAAB events from Bovada", updates.len());
                for u in &updates {
                    println!(
                        "  {} vs {} | {}",
                        u.away_team,
                        u.home_team,
                        u.bookmakers
                            .first()
                            .map(|b| format!("home={} away={}", b.home_odds, b.away_odds))
                            .unwrap_or_default()
                    );
                }
            }
            Err(e) => {
                println!("Bovada fetch error: {:#}", e);
            }
        }
    }
}
