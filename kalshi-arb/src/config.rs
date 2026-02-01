use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::io::{self, Write};
use std::path::Path;

const ENV_FILE: &str = ".env";

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct Config {
    pub kalshi: KalshiConfig,
    pub odds_sources: HashMap<String, OddsSourceConfig>,
    pub strategy: StrategyConfig,
    pub risk: RiskConfig,
    pub momentum: MomentumConfig,
    pub execution: ExecutionConfig,
    #[serde(default)]
    pub simulation: SimulationConfig,
    pub sports: HashMap<String, SportConfig>,
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
pub struct OddsSourceConfig {
    #[serde(rename = "type")]
    pub source_type: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub bookmakers: Option<String>,
    #[serde(default = "default_live_poll")]
    pub live_poll_s: u64,
    #[serde(default = "default_pre_game_poll")]
    pub pre_game_poll_s: u64,
    #[serde(default)]
    pub quota_warning_threshold: Option<u64>,
    #[serde(default = "default_request_timeout")]
    pub request_timeout_ms: u64,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
}

fn default_live_poll() -> u64 { 20 }
fn default_pre_game_poll() -> u64 { 120 }
fn default_request_timeout() -> u64 { 5000 }
fn default_max_retries() -> u32 { 2 }

#[derive(Debug, Deserialize, Clone)]
pub struct SportConfig {
    pub enabled: bool,
    pub kalshi_series: String,
    pub label: String,
    pub hotkey: String,
    pub fair_value: String,
    pub odds_source: String,
    pub score_feed: Option<ScoreFeedConfig>,
    pub win_prob: Option<WinProbConfig>,
    pub strategy: Option<StrategyOverride>,
    pub momentum: Option<MomentumOverride>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ScoreFeedConfig {
    pub primary_url: String,
    #[serde(default)]
    pub fallback_url: Option<String>,
    #[serde(default = "default_score_live_poll")]
    pub live_poll_s: u64,
    #[serde(default = "default_score_pre_game_poll")]
    pub pre_game_poll_s: u64,
    #[serde(default = "default_failover_threshold")]
    pub failover_threshold: u32,
    #[serde(default = "default_request_timeout")]
    pub request_timeout_ms: u64,
}

fn default_score_live_poll() -> u64 { 1 }
fn default_score_pre_game_poll() -> u64 { 60 }
fn default_failover_threshold() -> u32 { 3 }

#[derive(Debug, Deserialize, Clone)]
pub struct StrategyOverride {
    pub taker_edge_threshold: Option<u8>,
    pub maker_edge_threshold: Option<u8>,
    pub min_edge_after_fees: Option<u8>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct MomentumOverride {
    pub taker_momentum_threshold: Option<u8>,
    pub maker_momentum_threshold: Option<u8>,
    pub cancel_threshold: Option<u8>,
    pub velocity_weight: Option<f64>,
    pub book_pressure_weight: Option<f64>,
    pub velocity_window_size: Option<usize>,
    pub cancel_check_interval_ms: Option<u64>,
}

// Kept for internal use by DraftKingsFeed::new() — not part of the TOML schema.
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

// ── Resolution helpers ──────────────────────────────────────────────────

impl StrategyConfig {
    pub fn with_override(&self, ov: Option<&StrategyOverride>) -> StrategyConfig {
        match ov {
            None => self.clone(),
            Some(o) => StrategyConfig {
                taker_edge_threshold: o.taker_edge_threshold.unwrap_or(self.taker_edge_threshold),
                maker_edge_threshold: o.maker_edge_threshold.unwrap_or(self.maker_edge_threshold),
                min_edge_after_fees: o.min_edge_after_fees.unwrap_or(self.min_edge_after_fees),
            },
        }
    }
}

impl MomentumConfig {
    pub fn with_override(&self, ov: Option<&MomentumOverride>) -> MomentumConfig {
        match ov {
            None => self.clone(),
            Some(o) => MomentumConfig {
                taker_momentum_threshold: o.taker_momentum_threshold.unwrap_or(self.taker_momentum_threshold),
                maker_momentum_threshold: o.maker_momentum_threshold.unwrap_or(self.maker_momentum_threshold),
                cancel_threshold: o.cancel_threshold.unwrap_or(self.cancel_threshold),
                velocity_weight: o.velocity_weight.unwrap_or(self.velocity_weight),
                book_pressure_weight: o.book_pressure_weight.unwrap_or(self.book_pressure_weight),
                velocity_window_size: o.velocity_window_size.unwrap_or(self.velocity_window_size),
                cancel_check_interval_ms: o.cancel_check_interval_ms.unwrap_or(self.cancel_check_interval_ms),
                bypass_for_score_signals: false,
            },
        }
    }
}

// ── Runtime config persistence ──────────────────────────────────────────

/// Update a single field in the TOML config file at the given dotted path.
pub fn persist_field(config_path: &Path, dotted_key: &str, value: &str) -> Result<()> {
    let content = std::fs::read_to_string(config_path)?;
    let mut doc: toml::Value = toml::from_str(&content)?;

    let parts: Vec<&str> = dotted_key.split('.').collect();
    let mut current = &mut doc;
    for (i, part) in parts.iter().enumerate() {
        if i == parts.len() - 1 {
            // Set the value
            if let Some(table) = current.as_table_mut() {
                // Try to preserve the original type
                let old_val = table.get(*part);
                let new_val = match old_val {
                    Some(toml::Value::Integer(_)) => {
                        toml::Value::Integer(value.parse().unwrap_or(0))
                    }
                    Some(toml::Value::Float(_)) => {
                        toml::Value::Float(value.parse().unwrap_or(0.0))
                    }
                    Some(toml::Value::Boolean(_)) => {
                        toml::Value::Boolean(value.parse().unwrap_or(false))
                    }
                    _ => toml::Value::String(value.to_string()),
                };
                table.insert(part.to_string(), new_val);
            }
        } else {
            // Navigate into nested table, creating intermediate tables if needed
            if current.as_table().is_some_and(|t| !t.contains_key(*part)) {
                if let Some(table) = current.as_table_mut() {
                    table.insert(part.to_string(), toml::Value::Table(toml::map::Map::new()));
                }
            }
            current = current
                .get_mut(*part)
                .ok_or_else(|| anyhow::anyhow!("path not found: {}", dotted_key))?;
        }
    }

    let output = toml::to_string_pretty(&doc)?;
    std::fs::write(config_path, output)?;
    Ok(())
}

/// Remove a field from the TOML config, reverting to the global default.
pub fn remove_field(config_path: &Path, dotted_key: &str) -> Result<()> {
    let content = std::fs::read_to_string(config_path)?;
    let mut doc: toml::Value = toml::from_str(&content)?;

    let parts: Vec<&str> = dotted_key.split('.').collect();
    let mut current = &mut doc;
    for (i, part) in parts.iter().enumerate() {
        if i == parts.len() - 1 {
            if let Some(table) = current.as_table_mut() {
                table.remove(*part);
            }
        } else {
            current = current
                .get_mut(*part)
                .ok_or_else(|| anyhow::anyhow!("path not found: {}", dotted_key))?;
        }
    }

    let output = toml::to_string_pretty(&doc)?;
    std::fs::write(config_path, output)?;
    Ok(())
}

// ── Config loading & env helpers ────────────────────────────────────────

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_config_parses() {
        let toml_str = r#"
[kalshi]
api_base = "https://api.elections.kalshi.com"
ws_url = "wss://api.elections.kalshi.com/trade-api/ws/v2"

[odds_sources.the-odds-api]
type = "the-odds-api"
base_url = "https://api.the-odds-api.com"
bookmakers = "draftkings,fanduel,betmgm,caesars"
live_poll_s = 20
pre_game_poll_s = 120
quota_warning_threshold = 100

[strategy]
taker_edge_threshold = 5
maker_edge_threshold = 2
min_edge_after_fees = 1

[risk]
kelly_fraction = 0.25
max_contracts_per_market = 10
max_total_exposure_cents = 50000
max_concurrent_markets = 5

[momentum]
taker_momentum_threshold = 75
maker_momentum_threshold = 40
cancel_threshold = 30
velocity_weight = 0.6
book_pressure_weight = 0.4
velocity_window_size = 10
cancel_check_interval_ms = 1000

[execution]
maker_timeout_ms = 2000
stale_odds_threshold_ms = 30000

[simulation]
latency_ms = 500
use_break_even_exit = true

[sports.basketball]
enabled = true
kalshi_series = "KXNBAGAME"
label = "NBA"
hotkey = "1"
fair_value = "score-feed"
odds_source = "the-odds-api"

[sports.basketball.score_feed]
primary_url = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json"
fallback_url = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
live_poll_s = 1
pre_game_poll_s = 60
failover_threshold = 3
request_timeout_ms = 5000

[sports.basketball.win_prob]
home_advantage = 2.5
k_start = 0.065
k_range = 0.25
ot_k_start = 0.10
ot_k_range = 1.0
regulation_secs = 2880

[sports.basketball.strategy]
taker_edge_threshold = 3
maker_edge_threshold = 1

[sports.basketball.momentum]
taker_momentum_threshold = 0
maker_momentum_threshold = 0

[sports.ice-hockey]
enabled = true
kalshi_series = "KXNHLGAME"
label = "NHL"
hotkey = "4"
fair_value = "odds-feed"
odds_source = "the-odds-api"
"#;
        let config: Config = toml::from_str(toml_str).unwrap();
        assert_eq!(config.kalshi.api_base, "https://api.elections.kalshi.com");
        assert_eq!(config.strategy.taker_edge_threshold, 5);
        assert_eq!(config.sports.len(), 2);

        let bball = &config.sports["basketball"];
        assert!(bball.enabled);
        assert_eq!(bball.kalshi_series, "KXNBAGAME");
        assert_eq!(bball.fair_value, "score-feed");
        assert!(bball.score_feed.is_some());
        assert!(bball.win_prob.is_some());
        assert_eq!(bball.strategy.as_ref().unwrap().taker_edge_threshold, Some(3));
        assert_eq!(bball.momentum.as_ref().unwrap().taker_momentum_threshold, Some(0));

        let hockey = &config.sports["ice-hockey"];
        assert_eq!(hockey.fair_value, "odds-feed");
        assert!(hockey.score_feed.is_none());
        assert!(hockey.strategy.is_none());
    }

    #[test]
    fn test_strategy_override_resolution() {
        let global = StrategyConfig {
            taker_edge_threshold: 5,
            maker_edge_threshold: 2,
            min_edge_after_fees: 1,
        };
        let ov = StrategyOverride {
            taker_edge_threshold: Some(3),
            maker_edge_threshold: Some(1),
            min_edge_after_fees: None,
        };
        let resolved = global.with_override(Some(&ov));
        assert_eq!(resolved.taker_edge_threshold, 3);
        assert_eq!(resolved.maker_edge_threshold, 1);
        assert_eq!(resolved.min_edge_after_fees, 1);
    }

    #[test]
    fn test_momentum_override_resolution() {
        let global = MomentumConfig {
            taker_momentum_threshold: 75,
            maker_momentum_threshold: 40,
            cancel_threshold: 30,
            velocity_weight: 0.6,
            book_pressure_weight: 0.4,
            velocity_window_size: 10,
            cancel_check_interval_ms: 1000,
            bypass_for_score_signals: true,
        };
        let ov = MomentumOverride {
            taker_momentum_threshold: Some(0),
            maker_momentum_threshold: Some(0),
            cancel_threshold: None,
            velocity_weight: None,
            book_pressure_weight: None,
            velocity_window_size: None,
            cancel_check_interval_ms: None,
        };
        let resolved = global.with_override(Some(&ov));
        assert_eq!(resolved.taker_momentum_threshold, 0);
        assert_eq!(resolved.maker_momentum_threshold, 0);
        assert_eq!(resolved.cancel_threshold, 30);
        assert!(!resolved.bypass_for_score_signals);
    }

    #[test]
    fn test_config_file_parses() {
        let config = Config::load(std::path::Path::new("config.toml")).unwrap();
        assert_eq!(config.sports.len(), 8);
        assert!(config.odds_sources.contains_key("the-odds-api"));
        assert_eq!(config.sports["basketball"].fair_value, "score-feed");
        assert_eq!(config.sports["ice-hockey"].fair_value, "odds-feed");
        assert_eq!(config.sports["college-basketball"].fair_value, "score-feed");
        assert_eq!(config.sports["college-basketball-womens"].fair_value, "score-feed");
        assert_eq!(config.sports["mma"].fair_value, "odds-feed");
    }

    #[test]
    fn test_persist_field_roundtrip() {
        let dir = std::env::temp_dir().join("kalshi_test_persist");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test_config.toml");
        std::fs::write(
            &path,
            r#"
[strategy]
taker_edge_threshold = 5
maker_edge_threshold = 2
min_edge_after_fees = 1
"#,
        )
        .unwrap();

        persist_field(&path, "strategy.taker_edge_threshold", "8").unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("taker_edge_threshold = 8"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_persist_field_float() {
        let dir = std::env::temp_dir().join("kalshi_test_persist_float");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test_config.toml");
        std::fs::write(
            &path,
            r#"
[risk]
kelly_fraction = 0.25
"#,
        )
        .unwrap();

        persist_field(&path, "risk.kelly_fraction", "0.5").unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("kelly_fraction = 0.5"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_persist_field_bool() {
        let dir = std::env::temp_dir().join("kalshi_test_persist_bool");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test_config.toml");
        std::fs::write(
            &path,
            r#"
[simulation]
use_break_even_exit = true
"#,
        )
        .unwrap();

        persist_field(&path, "simulation.use_break_even_exit", "false").unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("use_break_even_exit = false"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_persist_field_creates_intermediate_tables() {
        let dir = std::env::temp_dir().join("kalshi_test_persist_nested");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test_config.toml");
        std::fs::write(
            &path,
            r#"
[sports.basketball]
enabled = true
"#,
        )
        .unwrap();

        persist_field(&path, "sports.basketball.strategy.taker_edge_threshold", "3").unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("taker_edge_threshold"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_remove_field() {
        let dir = std::env::temp_dir().join("kalshi_test_remove");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test_config.toml");
        std::fs::write(
            &path,
            r#"
[sports.basketball.strategy]
taker_edge_threshold = 3
maker_edge_threshold = 1
"#,
        )
        .unwrap();

        remove_field(&path, "sports.basketball.strategy.taker_edge_threshold").unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(!content.contains("taker_edge_threshold"));
        assert!(content.contains("maker_edge_threshold = 1"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
