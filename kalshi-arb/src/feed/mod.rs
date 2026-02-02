pub mod draftkings;
pub mod score_feed;
pub mod scraped;
pub mod the_odds_api;
pub mod types;

use anyhow::Result;
use async_trait::async_trait;
use types::{ApiQuota, OddsUpdate};

#[async_trait]
pub trait OddsFeed: Send + Sync {
    async fn fetch_odds(&mut self, sport: &str) -> Result<Vec<OddsUpdate>>;
    fn last_quota(&self) -> Option<ApiQuota>;
}
