use anyhow::{Context, Result};
use serde::Deserialize;
use std::io::{self, Write};
use std::path::Path;

const ENV_FILE: &str = ".env";

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct Config {
    pub strategy: StrategyConfig,
    pub risk: RiskConfig,
    pub execution: ExecutionConfig,
    pub kalshi: KalshiConfig,
    pub odds_feed: OddsFeedConfig,
    pub momentum: MomentumConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StrategyConfig {
    pub taker_edge_threshold: u8,
    pub maker_edge_threshold: u8,
    pub min_edge_after_fees: u8,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
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
    pub bookmakers: String,
    pub live_poll_interval_s: Option<u64>,
    pub pre_game_poll_interval_s: Option<u64>,
    pub quota_warning_threshold: Option<u64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct MomentumConfig {
    pub maker_momentum_threshold: u8,
    pub taker_momentum_threshold: u8,
    pub cancel_threshold: u8,
    pub velocity_weight: f64,
    pub book_pressure_weight: f64,
    pub cancel_check_interval_ms: u64,
    pub velocity_window_size: usize,
}

impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read config file: {}", path.display()))?;
        let config: Config = toml::from_str(&content)
            .with_context(|| "Failed to parse config TOML")?;
        Ok(config)
    }

    /// Load .env file into process environment. Real env vars take precedence.
    pub fn load_env_file() {
        let path = Path::new(ENV_FILE);
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return,
        };
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim();
                if std::env::var(key).is_err() {
                    std::env::set_var(key, value);
                }
            }
        }
    }

    /// API keys come from environment variables, or prompted at startup.
    /// Prompted values are saved to .env for future runs.
    pub fn kalshi_api_key() -> Result<String> {
        match std::env::var("KALSHI_API_KEY") {
            Ok(key) if !key.is_empty() => Ok(key),
            _ => {
                let key = prompt("Kalshi API Key")?;
                save_env_var("KALSHI_API_KEY", &key);
                Ok(key)
            }
        }
    }

    /// Returns the PEM content of the private key.
    /// Checks KALSHI_PRIVATE_KEY_PATH env var first, then prompts for a file path.
    /// Prompted path is saved to .env for future runs.
    pub fn kalshi_private_key_pem() -> Result<String> {
        let path = match std::env::var("KALSHI_PRIVATE_KEY_PATH") {
            Ok(p) if !p.is_empty() => p,
            _ => {
                let p = prompt("Kalshi Private Key file path")?;
                save_env_var("KALSHI_PRIVATE_KEY_PATH", &p);
                p
            }
        };

        let expanded = if path.starts_with('~') {
            let home = std::env::var("HOME").unwrap_or_default();
            path.replacen('~', &home, 1)
        } else {
            path.clone()
        };

        std::fs::read_to_string(&expanded)
            .with_context(|| format!("Failed to read private key file: {}", expanded))
    }

    pub fn odds_api_key() -> Result<String> {
        match std::env::var("ODDS_API_KEY") {
            Ok(key) if !key.is_empty() => Ok(key),
            _ => {
                let key = prompt("Odds API Key (the-odds-api.com)")?;
                save_env_var("ODDS_API_KEY", &key);
                Ok(key)
            }
        }
    }
}

fn prompt(label: &str) -> Result<String> {
    print!("  {} > ", label);
    io::stdout().flush()?;
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let value = input.trim().to_string();
    if value.is_empty() {
        anyhow::bail!("{} cannot be empty", label);
    }
    Ok(value)
}

/// Append a KEY=VALUE line to .env and set it in the current process.
fn save_env_var(key: &str, value: &str) {
    std::env::set_var(key, value);
    let path = Path::new(ENV_FILE);
    let mut contents = std::fs::read_to_string(path).unwrap_or_default();
    if !contents.is_empty() && !contents.ends_with('\n') {
        contents.push('\n');
    }
    contents.push_str(&format!("{}={}\n", key, value));
    let _ = std::fs::write(path, contents);
}
