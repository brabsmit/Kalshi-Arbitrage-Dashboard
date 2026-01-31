use super::types::*;
use super::OddsFeed;
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use std::time::{Duration, Instant};

const DK_BASE_URL: &str = "https://sportsbook-nash.draftkings.com/sites/US-SB/api/v5/eventgroups";

pub struct DraftKingsFeed {
    client: Client,
    poll_interval: Duration,
    configured_poll_interval: Duration,
    #[allow(dead_code)]
    pre_game_poll_interval: Duration,
    last_fetch: Option<Instant>,
    last_etag: Option<String>,
}

/// Map internal sport key to DraftKings (event_group_id, category_id, subcategory_id).
/// Basketball only for now.
fn dk_event_group(sport: &str) -> Option<(u64, u64, u64)> {
    match sport {
        "basketball" => Some((42648, 487, 4518)),
        _ => None,
    }
}

/// Parse DraftKings American odds string to f64.
/// Handles "+150", "-180", "EVEN" (= +100).
fn parse_american_odds(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.eq_ignore_ascii_case("EVEN") {
        return Some(100.0);
    }
    s.parse::<f64>().ok()
}

impl DraftKingsFeed {
    pub fn new(config: &crate::config::DraftKingsFeedConfig) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_millis(config.request_timeout_ms))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .build()
            .expect("failed to build reqwest client");

        let poll_interval = Duration::from_secs(config.live_poll_interval_s);
        Self {
            client,
            poll_interval,
            configured_poll_interval: poll_interval,
            pre_game_poll_interval: Duration::from_secs(config.pre_game_poll_interval_s),
            last_fetch: None,
            last_etag: None,
        }
    }

    /// Build the URL for fetching moneyline odds for a sport.
    fn build_url(group_id: u64, category_id: u64, subcategory_id: u64) -> String {
        format!(
            "{}/{}/categories/{}/subcategories/{}",
            DK_BASE_URL, group_id, category_id, subcategory_id
        )
    }
}

#[async_trait]
impl OddsFeed for DraftKingsFeed {
    async fn fetch_odds(&mut self, sport: &str) -> Result<Vec<OddsUpdate>> {
        let (group_id, category_id, subcategory_id) = dk_event_group(sport)
            .with_context(|| format!("DraftKings does not support sport: {}", sport))?;

        // Rate-limit
        if let Some(last) = self.last_fetch {
            let elapsed = last.elapsed();
            if elapsed < self.poll_interval {
                tokio::time::sleep(self.poll_interval - elapsed).await;
            }
        }

        let url = Self::build_url(group_id, category_id, subcategory_id);

        let mut req = self.client.get(&url);
        if let Some(ref etag) = self.last_etag {
            req = req.header("If-None-Match", etag.as_str());
        }

        let resp = req.send().await.context("DraftKings request failed")?;
        self.last_fetch = Some(Instant::now());

        // Handle 304 Not Modified (unchanged since last ETag)
        if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
            return Ok(Vec::new());
        }

        // Handle rate limiting
        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            tracing::warn!("DraftKings 429 rate limited, backing off");
            self.poll_interval = Duration::from_secs(
                self.poll_interval.as_secs().saturating_mul(2).min(30)
            );
            anyhow::bail!("DraftKings rate limited (429)");
        }

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("DraftKings API error ({}): {}", status, body);
        }

        // Reset poll interval on success (may have been doubled by 429 backoff)
        self.poll_interval = self.configured_poll_interval;

        // Store ETag for next conditional GET
        if let Some(etag) = resp.headers().get("etag") {
            self.last_etag = etag.to_str().ok().map(|s| s.to_string());
        }

        let dk_resp: DkResponse = resp.json().await
            .context("failed to parse DraftKings response")?;

        let Some(event_group) = dk_resp.event_group else {
            return Ok(Vec::new());
        };

        // Build event_id -> DkEvent lookup
        let event_map: std::collections::HashMap<u64, &DkEvent> = event_group.events
            .iter()
            .map(|e| (e.event_id, e))
            .collect();

        let mut updates: Vec<OddsUpdate> = Vec::new();

        // Flatten all offers across categories
        for category in &event_group.offer_categories {
            for offer_list in &category.offers {
                for offer in offer_list {
                    if offer.is_suspended || offer.outcomes.len() < 2 {
                        continue;
                    }

                    let Some(event) = event_map.get(&offer.event_id) else {
                        continue;
                    };

                    // Determine home/away from event team names or outcome labels
                    let (home_team, away_team) = match (&event.team_name1, &event.team_name2) {
                        (Some(t1), Some(t2)) => (t1.clone(), t2.clone()),
                        _ => {
                            // Fall back to outcome labels
                            if offer.outcomes.len() >= 2 {
                                (offer.outcomes[0].label.clone(), offer.outcomes[1].label.clone())
                            } else {
                                continue;
                            }
                        }
                    };

                    let home_odds = offer.outcomes.iter()
                        .find(|o| o.label == home_team)
                        .and_then(|o| parse_american_odds(&o.odds_american));
                    let away_odds = offer.outcomes.iter()
                        .find(|o| o.label == away_team)
                        .and_then(|o| parse_american_odds(&o.odds_american));

                    if let (Some(h), Some(a)) = (home_odds, away_odds) {
                        updates.push(OddsUpdate {
                            event_id: offer.event_id.to_string(),
                            sport: sport.to_string(),
                            home_team: home_team.clone(),
                            away_team: away_team.clone(),
                            commence_time: event.start_date.clone(),
                            bookmakers: vec![BookmakerOdds {
                                name: "DraftKings".to_string(),
                                home_odds: h,
                                away_odds: a,
                                draw_odds: None,
                                last_update: chrono::Utc::now().to_rfc3339(),
                            }],
                        });
                    }
                }
            }
        }

        Ok(updates)
    }

    fn last_quota(&self) -> Option<ApiQuota> {
        None // DraftKings has no API quota concept
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dk_event_group_basketball() {
        assert_eq!(dk_event_group("basketball"), Some((42648, 487, 4518)));
    }

    #[test]
    fn test_dk_event_group_unknown() {
        assert_eq!(dk_event_group("baseball"), None);
    }

    #[test]
    fn test_parse_dk_odds_positive() {
        assert!((parse_american_odds("+150").unwrap() - 150.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_dk_odds_negative() {
        assert!((parse_american_odds("-180").unwrap() - (-180.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_dk_odds_even() {
        assert!((parse_american_odds("EVEN").unwrap() - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_dk_odds_invalid() {
        assert!(parse_american_odds("").is_none());
        assert!(parse_american_odds("abc").is_none());
    }

    /// Integration test: hits the real DraftKings API.
    /// Run with: cargo test dk_live --ignored -- --nocapture
    #[tokio::test]
    #[ignore]
    async fn dk_live_fetch() {
        let config = crate::config::DraftKingsFeedConfig::default();
        let mut feed = DraftKingsFeed::new(&config);
        match feed.fetch_odds("basketball").await {
            Ok(updates) => {
                println!("Got {} NBA events from DraftKings", updates.len());
                for u in &updates {
                    println!("  {} vs {} | bookmakers: {}", u.home_team, u.away_team, u.bookmakers.len());
                    for bm in &u.bookmakers {
                        println!("    {}: home={} away={}", bm.name, bm.home_odds, bm.away_odds);
                    }
                }
            }
            Err(e) => {
                println!("DK fetch error (may be expected if not in US): {:#}", e);
            }
        }
    }
}
