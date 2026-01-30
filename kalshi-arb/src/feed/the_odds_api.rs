use super::types::*;
use super::OddsFeed;
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;

pub struct TheOddsApi {
    client: Client,
    api_key: String,
    base_url: String,
    bookmakers: String,
    last_quota: Option<ApiQuota>,
}

/// Map our internal sport key to the-odds-api.com sport key.
fn api_sport_key(sport: &str) -> &str {
    match sport {
        "basketball" => "basketball_nba",
        "american-football" => "americanfootball_nfl",
        "baseball" => "baseball_mlb",
        "ice-hockey" => "icehockey_nhl",
        "college-basketball" => "basketball_ncaab",
        "soccer-epl" => "soccer_epl",
        "mma" => "mma_mixed_martial_arts",
        _ => sport,
    }
}

impl TheOddsApi {
    pub fn new(api_key: String, base_url: &str, bookmakers: &str) -> Self {
        Self {
            client: Client::new(),
            api_key,
            base_url: base_url.trim_end_matches('/').to_string(),
            bookmakers: bookmakers.to_string(),
            last_quota: None,
        }
    }
}

#[async_trait]
impl OddsFeed for TheOddsApi {
    async fn fetch_odds(&mut self, sport: &str) -> Result<Vec<OddsUpdate>> {
        let api_sport = api_sport_key(sport);

        let url = format!(
            "{}/v4/sports/{}/odds?apiKey={}&regions=us&markets=h2h&oddsFormat=american&bookmakers={}",
            self.base_url, api_sport, self.api_key, self.bookmakers,
        );

        let resp = self.client.get(&url).send().await
            .context("the-odds-api request failed")?;

        // Extract quota from response headers
        let used = resp.headers()
            .get("x-requests-used")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        let remaining = resp.headers()
            .get("x-requests-remaining")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        self.last_quota = Some(ApiQuota {
            requests_used: used,
            requests_remaining: remaining,
        });

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("the-odds-api {} ({}): {}", api_sport, status, body);
        }

        let events: Vec<TheOddsApiEvent> = resp.json().await
            .context("failed to parse the-odds-api response")?;

        let mut updates: Vec<OddsUpdate> = Vec::new();

        for event in events {
            let mut bookmaker_odds: Vec<BookmakerOdds> = Vec::new();

            for bm in &event.bookmakers {
                // Find h2h (moneyline) market
                let h2h = bm.markets.iter().find(|m| m.key == "h2h");

                if let Some(market) = h2h {
                    let home_price = market.outcomes.iter()
                        .find(|o| o.name == event.home_team)
                        .map(|o| o.price);
                    let away_price = market.outcomes.iter()
                        .find(|o| o.name == event.away_team)
                        .map(|o| o.price);
                    let draw_price = market.outcomes.iter()
                        .find(|o| o.name == "Draw")
                        .map(|o| o.price);

                    if let (Some(h), Some(a)) = (home_price, away_price) {
                        bookmaker_odds.push(BookmakerOdds {
                            name: bm.title.clone(),
                            home_odds: h,
                            away_odds: a,
                            draw_odds: draw_price,
                            last_update: bm.last_update.clone(),
                        });
                    }
                }
            }

            if !bookmaker_odds.is_empty() {
                updates.push(OddsUpdate {
                    event_id: event.id,
                    sport: sport.to_string(),
                    home_team: event.home_team,
                    away_team: event.away_team,
                    commence_time: event.commence_time,
                    bookmakers: bookmaker_odds,
                });
            }
        }

        Ok(updates)
    }

    fn last_quota(&self) -> Option<ApiQuota> {
        self.last_quota.clone()
    }
}
