use super::types::*;
use super::OddsFeed;
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;

pub struct OddsApiIo {
    client: Client,
    api_key: String,
    base_url: String,
}

impl OddsApiIo {
    pub fn new(api_key: String, base_url: &str) -> Self {
        Self {
            client: Client::new(),
            api_key,
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }
}

#[async_trait]
impl OddsFeed for OddsApiIo {
    async fn fetch_odds(&mut self, sport: &str) -> Result<Vec<OddsUpdate>> {
        let url = format!(
            "{}/odds?sport={}&markets=ML&apiKey={}",
            self.base_url, sport, self.api_key,
        );

        let resp = self.client.get(&url).send().await
            .context("odds-api.io request failed")?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("odds-api.io {} ({}): {}", sport, status, body);
        }

        let events: Vec<OddsApiEvent> = resp.json().await
            .context("failed to parse odds-api.io response")?;

        let updates = events
            .into_iter()
            .map(|e| {
                let bookmakers = e.bookmakers.into_iter().filter_map(|b| {
                    let h2h = b.markets.iter().find(|m| m.key == "ML" || m.key == "h2h")?;
                    let home = h2h.outcomes.iter()
                        .find(|o| o.name == e.home_team)?;
                    let away = h2h.outcomes.iter()
                        .find(|o| o.name == e.away_team)?;
                    Some(BookmakerOdds {
                        name: b.title,
                        home_odds: home.price,
                        away_odds: away.price,
                        last_update: b.last_update,
                    })
                }).collect();

                OddsUpdate {
                    event_id: e.id,
                    sport: e.sport_key,
                    home_team: e.home_team,
                    away_team: e.away_team,
                    commence_time: e.commence_time,
                    bookmakers,
                }
            })
            .collect();

        Ok(updates)
    }
}
