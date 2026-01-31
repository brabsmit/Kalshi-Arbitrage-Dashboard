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
    #[serde(default)]
    pub sports: SportsConfig,
    pub odds_feed: OddsFeedConfig,
    pub draftkings_feed: Option<DraftKingsFeedConfig>,
    pub momentum: MomentumConfig,
    pub score_feed: Option<ScoreFeedConfig>,
    pub college_score_feed: Option<CollegeScoreFeedConfig>,
    pub simulation: Option<SimulationConfig>,
    pub win_prob: Option<WinProbConfig>,
    pub college_win_prob: Option<WinProbConfig>,
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
    pub kelly_fraction: f64,
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
pub struct SportsConfig {
    #[serde(default)]
    pub basketball: bool,
    #[serde(default, alias = "american-football")]
    pub american_football: bool,
    #[serde(default)]
    pub baseball: bool,
    #[serde(default, alias = "ice-hockey")]
    pub ice_hockey: bool,
    #[serde(default, alias = "college-basketball")]
    pub college_basketball: bool,
    #[serde(default, alias = "college-basketball-womens")]
    pub college_basketball_womens: bool,
    #[serde(default, alias = "soccer-epl")]
    pub soccer_epl: bool,
    #[serde(default)]
    pub mma: bool,
}

impl Default for SportsConfig {
    fn default() -> Self {
        Self {
            basketball: true,
            american_football: true,
            baseball: true,
            ice_hockey: true,
            college_basketball: true,
            college_basketball_womens: true,
            soccer_epl: true,
            mma: true,
        }
    }
}

impl SportsConfig {
    /// Return the list of enabled sport keys (using the hyphenated API names).
    pub fn enabled_keys(&self) -> Vec<String> {
        let mut out = Vec::new();
        if self.basketball { out.push("basketball".to_string()); }
        if self.american_football { out.push("american-football".to_string()); }
        if self.baseball { out.push("baseball".to_string()); }
        if self.ice_hockey { out.push("ice-hockey".to_string()); }
        if self.college_basketball { out.push("college-basketball".to_string()); }
        if self.college_basketball_womens { out.push("college-basketball-womens".to_string()); }
        if self.soccer_epl { out.push("soccer-epl".to_string()); }
        if self.mma { out.push("mma".to_string()); }
        out
    }
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct OddsFeedConfig {
    pub provider: String,
    pub base_url: String,
    pub bookmakers: String,
    pub live_poll_interval_s: Option<u64>,
    pub pre_game_poll_interval_s: Option<u64>,
    pub quota_warning_threshold: Option<u64>,
    #[serde(default = "default_source_strategy")]
    pub source_strategy: String,
}

fn default_source_strategy() -> String {
    "the-odds-api".to_string()
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct DraftKingsFeedConfig {
    #[serde(default = "default_dk_live_poll")]
    pub live_poll_interval_s: u64,
    #[serde(default = "default_dk_pre_game_poll")]
    pub pre_game_poll_interval_s: u64,
    #[serde(default = "default_dk_timeout")]
    pub request_timeout_ms: u64,
}

fn default_dk_live_poll() -> u64 { 3 }
fn default_dk_pre_game_poll() -> u64 { 30 }
fn default_dk_timeout() -> u64 { 5000 }

impl Default for DraftKingsFeedConfig {
    fn default() -> Self {
        Self {
            live_poll_interval_s: 3,
            pre_game_poll_interval_s: 30,
            request_timeout_ms: 5000,
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct ScoreFeedConfig {
    pub nba_api_url: String,
    pub espn_api_url: String,
    pub live_poll_interval_s: u64,
    pub pre_game_poll_interval_s: u64,
    pub failover_threshold: u32,
    pub request_timeout_ms: u64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct CollegeScoreFeedConfig {
    pub espn_mens_url: String,
    pub espn_womens_url: String,
    pub live_poll_interval_s: u64,
    pub pre_game_poll_interval_s: u64,
    pub request_timeout_ms: u64,
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
    /// Bypass momentum gating for score-feed signals (where speed is the edge).
    #[serde(default)]
    pub bypass_for_score_signals: bool,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SimulationConfig {
    pub latency_ms: u64,
    pub use_break_even_exit: bool,
}

impl Default for SimulationConfig {
    fn default() -> Self {
        Self {
            latency_ms: 500,
            use_break_even_exit: true,
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct WinProbConfig {
    pub home_advantage: f64,
    pub k_start: f64,
    pub k_range: f64,
    pub ot_k_start: f64,
    pub ot_k_range: f64,
    #[serde(default)]
    pub regulation_secs: Option<u16>,
}

impl Default for WinProbConfig {
    fn default() -> Self {
        Self {
            home_advantage: 2.5,
            k_start: 0.065,
            k_range: 0.25,
            ot_k_start: 0.10,
            ot_k_range: 1.0,
            regulation_secs: Some(2880),
        }
    }
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
        // Strip BOM if present (common on Windows-created files)
        let content = content.strip_prefix('\u{feff}').unwrap_or(&content);
        for line in content.lines() {
            let line = line.trim().trim_matches('\r');
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim().trim_matches('"').trim_matches('\'');
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
            Ok(key) if !key.is_empty() => Ok(sanitize_key(&key)),
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
            Ok(p) if !p.is_empty() => sanitize_key(&p),
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

        let pem = std::fs::read_to_string(&expanded)
            .with_context(|| format!("Failed to read private key file: {}", expanded))?;

        let byte_count = pem.len();
        let has_cr = pem.contains('\r');
        let has_bom = pem.starts_with('\u{feff}');

        // Detect PEM type for diagnostics
        let pem_type = if pem.contains("BEGIN RSA PRIVATE KEY") {
            "PKCS#1"
        } else if pem.contains("BEGIN PRIVATE KEY") {
            "PKCS#8"
        } else {
            "UNKNOWN"
        };

        println!("  Private key file: {} ({} bytes, format: {}, CR: {}, BOM: {})",
            expanded, byte_count, pem_type, has_cr, has_bom);

        // Strip BOM and carriage returns
        let pem = pem.strip_prefix('\u{feff}').unwrap_or(&pem).to_string();

        Ok(pem)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_parses() {
        let config = Config::load(Path::new("config.toml")).unwrap();
        assert_eq!(config.momentum.maker_momentum_threshold, 40);
        assert_eq!(config.momentum.taker_momentum_threshold, 75);
        assert_eq!(config.momentum.cancel_threshold, 30);
        assert!(config.odds_feed.live_poll_interval_s.is_some());
        assert!(config.sports.basketball);
    }
}

/// Strip carriage returns, BOM, and other invisible chars from a key/path value.
fn sanitize_key(raw: &str) -> String {
    raw.replace(['\r', '\u{feff}', '\u{200b}'], "")
        .trim()
        .to_string()
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
