pub mod odds_api_io;
pub mod types;

use anyhow::Result;
use async_trait::async_trait;
use types::OddsUpdate;

#[async_trait]
pub trait OddsFeed: Send + Sync {
    async fn fetch_odds(&mut self, sport: &str) -> Result<Vec<OddsUpdate>>;
}
