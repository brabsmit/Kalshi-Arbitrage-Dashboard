use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct Config {
    pub strategy: StrategyConfig,
    pub risk: RiskConfig,
    pub execution: ExecutionConfig,
    pub kalshi: KalshiConfig,
    pub odds_feed: OddsFeedConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StrategyConfig {
    pub taker_edge_threshold: u8,
    pub maker_edge_threshold: u8,
    pub min_edge_after_fees: u8,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RiskConfig {
    pub max_contracts_per_market: u32,
    pub max_total_exposure_cents: u64,
    pub max_concurrent_markets: u32,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct ExecutionConfig {
    pub maker_timeout_ms: u64,
    pub stale_odds_threshold_ms: u64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct KalshiConfig {
    pub api_base: String,
    pub ws_url: String,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct OddsFeedConfig {
    pub provider: String,
    pub sports: Vec<String>,
    pub base_url: String,
}

impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read config file: {}", path.display()))?;
        let config: Config = toml::from_str(&content)
            .with_context(|| "Failed to parse config TOML")?;
        Ok(config)
    }

    /// API keys come from environment variables, never config files.
    pub fn kalshi_api_key() -> Result<String> {
        std::env::var("KALSHI_API_KEY")
            .context("KALSHI_API_KEY environment variable not set")
    }

    pub fn kalshi_private_key_path() -> Result<String> {
        std::env::var("KALSHI_PRIVATE_KEY_PATH")
            .context("KALSHI_PRIVATE_KEY_PATH environment variable not set")
    }

    pub fn odds_api_key() -> Result<String> {
        std::env::var("ODDS_API_KEY")
            .context("ODDS_API_KEY environment variable not set")
    }
}
