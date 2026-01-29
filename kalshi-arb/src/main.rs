mod config;
mod engine;
mod feed;
mod kalshi;
mod tui;

use anyhow::Result;
use config::Config;
use std::path::Path;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let config = Config::load(Path::new("config.toml"))?;
    tracing::info!("loaded configuration");

    match Config::kalshi_api_key() {
        Ok(key) => tracing::info!(key_len = key.len(), "kalshi API key loaded"),
        Err(_) => tracing::warn!("KALSHI_API_KEY not set, running in read-only mode"),
    }

    Ok(())
}
