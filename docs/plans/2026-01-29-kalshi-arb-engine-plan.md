# Kalshi Arbitrage Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a low-latency Rust trading engine that exploits millisecond delays between sportsbook odds and Kalshi market prices.

**Architecture:** Single Rust binary with async tokio runtime. Three concurrent subsystems (odds ingress, Kalshi feed, strategy/execution engine) connected by mpsc channels. TUI via ratatui for monitoring.

**Tech Stack:** Rust, tokio, tokio-tungstenite, reqwest, serde, ratatui, ring (RSA-PSS), crossterm

---

## Task 1: Scaffold Rust project with dependencies

**Files:**
- Create: `kalshi-arb/Cargo.toml`
- Create: `kalshi-arb/src/main.rs`
- Create: `kalshi-arb/config.toml`

**Step 1: Initialize cargo project**

Run: `cargo init kalshi-arb` from the repo root.

**Step 2: Write Cargo.toml with all dependencies**

```toml
[package]
name = "kalshi-arb"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = { version = "0.24", features = ["native-tls"] }
reqwest = { version = "0.12", features = ["json", "native-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
ring = "0.17"
ratatui = "0.29"
crossterm = "0.28"
toml = "0.8"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
chrono = { version = "0.4", features = ["serde"] }
anyhow = "1"
base64 = "0.22"
futures-util = "0.3"
url = "2"
async-trait = "0.1"
```

**Step 3: Write minimal main.rs that compiles**

```rust
use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    tracing::info!("kalshi-arb starting");
    Ok(())
}
```

**Step 4: Write default config.toml**

```toml
[strategy]
taker_edge_threshold = 5
maker_edge_threshold = 2
min_edge_after_fees = 1

[risk]
max_contracts_per_market = 10
max_total_exposure_cents = 50000
max_concurrent_markets = 5

[execution]
maker_timeout_ms = 500
stale_odds_threshold_ms = 5000

[kalshi]
api_base = "https://api.elections.kalshi.com"
ws_url = "wss://api.elections.kalshi.com/trade-api/ws/v2"

[odds_feed]
provider = "odds-api-io"
sports = ["americanfootball_nfl", "basketball_nba", "baseball_mlb", "icehockey_nhl"]
base_url = "https://api.odds-api.io/v3"
```

**Step 5: Verify it compiles**

Run: `cd kalshi-arb && cargo build`
Expected: Compiles with no errors.

**Step 6: Commit**

```bash
git add kalshi-arb/
git commit -m "feat: scaffold kalshi-arb Rust project with dependencies"
```

---

## Task 2: Config module — parse TOML config with env overrides

**Files:**
- Create: `kalshi-arb/src/config.rs`
- Modify: `kalshi-arb/src/main.rs`

**Step 1: Write config.rs**

```rust
use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, Clone)]
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
```

**Step 2: Update main.rs to load config**

```rust
mod config;

use anyhow::Result;
use config::Config;
use std::path::Path;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let config = Config::load(Path::new("config.toml"))?;
    tracing::info!(?config, "loaded configuration");

    Ok(())
}
```

**Step 3: Verify it compiles and runs**

Run: `cd kalshi-arb && cargo run`
Expected: Prints config and exits.

**Step 4: Commit**

```bash
git add kalshi-arb/src/config.rs kalshi-arb/src/main.rs
git commit -m "feat: add config module with TOML parsing and env var overrides"
```

---

## Task 3: Kalshi auth — RSA-PSS request signing

**Files:**
- Create: `kalshi-arb/src/kalshi/mod.rs`
- Create: `kalshi-arb/src/kalshi/auth.rs`
- Create: `kalshi-arb/src/kalshi/types.rs`
- Modify: `kalshi-arb/src/main.rs`

**Step 1: Create module structure**

Create `kalshi-arb/src/kalshi/mod.rs`:
```rust
pub mod auth;
pub mod types;
```

**Step 2: Write types.rs with Kalshi data structures**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct CreateOrderRequest {
    pub ticker: String,
    pub action: String,       // "buy" or "sell"
    pub side: String,         // "yes" or "no"
    pub count: u32,
    #[serde(rename = "type")]
    pub order_type: String,   // "limit"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yes_price: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_price: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_order_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OrderResponse {
    pub order: Order,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Order {
    pub order_id: String,
    pub ticker: String,
    pub side: String,
    pub action: String,
    pub status: String,
    pub yes_price: u32,
    pub no_price: u32,
    #[serde(default)]
    pub fill_count: u32,
    #[serde(default)]
    pub remaining_count: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MarketsResponse {
    pub markets: Vec<Market>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Market {
    pub ticker: String,
    pub event_ticker: String,
    pub title: String,
    pub status: String,
    #[serde(default)]
    pub yes_bid: u32,
    #[serde(default)]
    pub yes_ask: u32,
    #[serde(default)]
    pub no_bid: u32,
    #[serde(default)]
    pub no_ask: u32,
    #[serde(default)]
    pub volume: u64,
    #[serde(default)]
    pub open_interest: u64,
    pub close_time: Option<String>,
    pub expected_expiration_time: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BalanceResponse {
    pub balance: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PortfolioPositionsResponse {
    pub market_positions: Vec<MarketPosition>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MarketPosition {
    pub ticker: String,
    pub market_exposure: i64,
    pub position: i64,
    #[serde(default)]
    pub resting_orders_count: u32,
}

/// WebSocket orderbook snapshot message
#[derive(Debug, Clone, Deserialize)]
pub struct OrderbookSnapshot {
    pub market_ticker: String,
    /// Each entry is [price_cents, quantity]
    pub yes: Vec<[i64; 2]>,
    pub no: Vec<[i64; 2]>,
}

/// WebSocket orderbook delta message
#[derive(Debug, Clone, Deserialize)]
pub struct OrderbookDelta {
    pub market_ticker: String,
    pub price: u32,
    pub delta: i64,
    pub side: String, // "yes" or "no"
}

/// Wrapper for WS messages
#[derive(Debug, Clone, Deserialize)]
pub struct WsMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(default)]
    pub sid: u64,
    #[serde(default)]
    pub seq: u64,
    pub msg: serde_json::Value,
}
```

**Step 3: Write auth.rs with RSA-PSS signing**

```rust
use anyhow::{Context, Result};
use base64::Engine as _;
use ring::rand::SystemRandom;
use ring::signature::{RsaKeyPair, RSA_PSS_SHA256};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct KalshiAuth {
    api_key: String,
    key_pair: RsaKeyPair,
    rng: SystemRandom,
}

impl KalshiAuth {
    pub fn new(api_key: String, private_key_pem: &str) -> Result<Self> {
        let der = pem_to_der(private_key_pem)?;
        let key_pair = RsaKeyPair::from_pkcs8(&der)
            .map_err(|e| anyhow::anyhow!("Failed to parse RSA key: {}", e))?;
        Ok(Self {
            api_key,
            key_pair,
            rng: SystemRandom::new(),
        })
    }

    pub fn timestamp_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    /// Sign a request and return (timestamp, signature) for headers.
    pub fn sign(&self, method: &str, path: &str) -> Result<(String, String)> {
        let timestamp = Self::timestamp_ms().to_string();
        // Strip query params before signing
        let path_clean = path.split('?').next().unwrap_or(path);
        let message = format!("{}{}{}", timestamp, method, path_clean);

        let mut signature = vec![0u8; self.key_pair.public().modulus_len()];
        self.key_pair
            .sign(&RSA_PSS_SHA256, &self.rng, message.as_bytes(), &mut signature)
            .map_err(|e| anyhow::anyhow!("RSA signing failed: {}", e))?;

        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(&signature);
        Ok((timestamp, sig_b64))
    }

    pub fn api_key(&self) -> &str {
        &self.api_key
    }

    /// Build auth headers for a request.
    pub fn headers(&self, method: &str, path: &str) -> Result<Vec<(String, String)>> {
        let (timestamp, signature) = self.sign(method, path)?;
        Ok(vec![
            ("KALSHI-ACCESS-KEY".to_string(), self.api_key.clone()),
            ("KALSHI-ACCESS-TIMESTAMP".to_string(), timestamp),
            ("KALSHI-ACCESS-SIGNATURE".to_string(), signature),
        ])
    }
}

/// Convert PEM-encoded private key to DER bytes.
fn pem_to_der(pem: &str) -> Result<Vec<u8>> {
    let pem = pem.trim();
    let b64: String = pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");
    base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .context("Failed to decode PEM base64")
}
```

**Step 4: Update main.rs**

```rust
mod config;
mod kalshi;

use anyhow::Result;
use config::Config;
use std::path::Path;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let config = Config::load(Path::new("config.toml"))?;
    tracing::info!("loaded configuration");

    // Verify auth loads (will fail without env vars, that's ok)
    match Config::kalshi_api_key() {
        Ok(key) => tracing::info!(key_len = key.len(), "kalshi API key loaded"),
        Err(_) => tracing::warn!("KALSHI_API_KEY not set, running in read-only mode"),
    }

    Ok(())
}
```

**Step 5: Verify it compiles**

Run: `cd kalshi-arb && cargo build`

**Step 6: Commit**

```bash
git add kalshi-arb/src/kalshi/
git commit -m "feat: add Kalshi auth module with RSA-PSS signing"
```

---

## Task 4: Kalshi REST client — markets, orders, portfolio

**Files:**
- Create: `kalshi-arb/src/kalshi/rest.rs`
- Modify: `kalshi-arb/src/kalshi/mod.rs`

**Step 1: Write rest.rs**

```rust
use super::auth::KalshiAuth;
use super::types::*;
use anyhow::{Context, Result};
use reqwest::Client;
use std::sync::Arc;

pub struct KalshiRest {
    client: Client,
    auth: Arc<KalshiAuth>,
    base_url: String,
}

impl KalshiRest {
    pub fn new(auth: Arc<KalshiAuth>, base_url: &str) -> Self {
        let client = Client::builder()
            .http2_prior_knowledge()
            .pool_max_idle_per_host(4)
            .build()
            .expect("failed to build HTTP client");
        Self {
            client,
            auth,
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    /// Fetch all markets for a given series ticker. Paginates automatically.
    pub async fn get_markets_by_series(&self, series_ticker: &str) -> Result<Vec<Market>> {
        let mut all_markets = Vec::new();
        let mut cursor: Option<String> = None;

        loop {
            let path = "/trade-api/v2/markets";
            let mut url = format!("{}{}", self.base_url, path);
            url.push_str(&format!("?series_ticker={}&limit=200&status=open", series_ticker));
            if let Some(ref c) = cursor {
                url.push_str(&format!("&cursor={}", c));
            }

            let resp: MarketsResponse = self.get(&url, path).await?;
            let done = resp.cursor.is_none() || resp.markets.is_empty();
            all_markets.extend(resp.markets);
            if done {
                break;
            }
            cursor = resp.cursor;
        }

        Ok(all_markets)
    }

    /// Place an order.
    pub async fn create_order(&self, order: &CreateOrderRequest) -> Result<OrderResponse> {
        let path = "/trade-api/v2/portfolio/orders";
        let url = format!("{}{}", self.base_url, path);

        let headers = self.auth.headers("POST", path)?;
        let mut req = self.client.post(&url).json(order);
        for (k, v) in &headers {
            req = req.header(k, v);
        }

        let resp = req.send().await.context("order request failed")?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("order failed ({}): {}", status, body);
        }
        resp.json().await.context("failed to parse order response")
    }

    /// Get account balance.
    pub async fn get_balance(&self) -> Result<i64> {
        let path = "/trade-api/v2/portfolio/balance";
        let url = format!("{}{}", self.base_url, path);
        let resp: BalanceResponse = self.get_authed(&url, path).await?;
        Ok(resp.balance)
    }

    /// Get open positions.
    pub async fn get_positions(&self) -> Result<Vec<MarketPosition>> {
        let path = "/trade-api/v2/portfolio/positions";
        let url = format!("{}{}", self.base_url, path);
        let resp: PortfolioPositionsResponse = self.get_authed(&url, path).await?;
        Ok(resp.market_positions)
    }

    /// Authenticated GET request.
    async fn get_authed<T: serde::de::DeserializeOwned>(&self, url: &str, path: &str) -> Result<T> {
        let headers = self.auth.headers("GET", path)?;
        let mut req = self.client.get(url);
        for (k, v) in &headers {
            req = req.header(k, v);
        }
        let resp = req.send().await.context("GET request failed")?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("GET {} failed ({}): {}", path, status, body);
        }
        resp.json().await.context("failed to parse response")
    }

    /// Unauthenticated GET (for public endpoints like /markets).
    async fn get<T: serde::de::DeserializeOwned>(&self, url: &str, _path: &str) -> Result<T> {
        let resp = self.client.get(url).send().await.context("GET request failed")?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("GET failed ({}): {}", status, body);
        }
        resp.json().await.context("failed to parse response")
    }
}
```

**Step 2: Update kalshi/mod.rs**

```rust
pub mod auth;
pub mod rest;
pub mod types;
```

**Step 3: Verify it compiles**

Run: `cd kalshi-arb && cargo build`

**Step 4: Commit**

```bash
git add kalshi-arb/src/kalshi/
git commit -m "feat: add Kalshi REST client for markets, orders, portfolio"
```

---

## Task 5: Kalshi WebSocket — orderbook subscriptions

**Files:**
- Create: `kalshi-arb/src/kalshi/ws.rs`
- Modify: `kalshi-arb/src/kalshi/mod.rs`

**Step 1: Write ws.rs**

```rust
use super::auth::KalshiAuth;
use super::types::{OrderbookDelta, OrderbookSnapshot, WsMessage};
use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

/// Events emitted by the Kalshi WebSocket connection.
#[derive(Debug, Clone)]
pub enum KalshiWsEvent {
    Snapshot(OrderbookSnapshot),
    Delta(OrderbookDelta),
    Connected,
    Disconnected(String),
}

pub struct KalshiWs {
    auth: Arc<KalshiAuth>,
    ws_url: String,
}

impl KalshiWs {
    pub fn new(auth: Arc<KalshiAuth>, ws_url: &str) -> Self {
        Self {
            auth,
            ws_url: ws_url.to_string(),
        }
    }

    /// Connect and run the WebSocket loop. Sends events on `tx`.
    /// `tickers` are subscribed immediately after connect.
    pub async fn run(
        &self,
        tickers: Vec<String>,
        tx: mpsc::Sender<KalshiWsEvent>,
    ) -> Result<()> {
        loop {
            match self.connect_and_listen(&tickers, &tx).await {
                Ok(()) => {
                    tracing::warn!("kalshi WS closed cleanly, reconnecting...");
                }
                Err(e) => {
                    tracing::error!("kalshi WS error: {:#}, reconnecting in 2s...", e);
                    let _ = tx.send(KalshiWsEvent::Disconnected(format!("{:#}", e))).await;
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    }

    async fn connect_and_listen(
        &self,
        tickers: &[String],
        tx: &mpsc::Sender<KalshiWsEvent>,
    ) -> Result<()> {
        // Build auth for WS handshake
        let path = "/trade-api/ws/v2";
        let headers = self.auth.headers("GET", path)?;

        let mut request = url::Url::parse(&self.ws_url)?;
        // Pass auth as query params (Kalshi WS auth method)
        for (k, v) in &headers {
            request.query_pairs_mut().append_pair(k, v);
        }

        let (ws_stream, _) = tokio_tungstenite::connect_async(request.as_str())
            .await
            .context("WS connection failed")?;

        let (mut write, mut read) = ws_stream.split();
        tracing::info!("kalshi WS connected");
        let _ = tx.send(KalshiWsEvent::Connected).await;

        // Subscribe to orderbook_delta for all tickers (batch in groups of 50)
        for chunk in tickers.chunks(50) {
            let sub = serde_json::json!({
                "id": 1,
                "cmd": "subscribe",
                "params": {
                    "channels": ["orderbook_delta"],
                    "market_tickers": chunk,
                }
            });
            write
                .send(Message::Text(sub.to_string().into()))
                .await
                .context("WS subscribe failed")?;
        }

        tracing::info!(count = tickers.len(), "subscribed to tickers");

        // Read loop
        while let Some(msg) = read.next().await {
            let msg = msg.context("WS read error")?;
            match msg {
                Message::Text(text) => {
                    if let Err(e) = self.handle_message(&text, tx).await {
                        tracing::warn!("WS message parse error: {:#}", e);
                    }
                }
                Message::Ping(data) => {
                    write.send(Message::Pong(data)).await?;
                }
                Message::Close(_) => {
                    tracing::info!("kalshi WS received close frame");
                    break;
                }
                _ => {}
            }
        }

        Ok(())
    }

    async fn handle_message(
        &self,
        text: &str,
        tx: &mpsc::Sender<KalshiWsEvent>,
    ) -> Result<()> {
        let ws_msg: WsMessage = serde_json::from_str(text)
            .context("failed to parse WS message")?;

        match ws_msg.msg_type.as_str() {
            "orderbook_snapshot" => {
                let snapshot: OrderbookSnapshot = serde_json::from_value(ws_msg.msg)?;
                let _ = tx.send(KalshiWsEvent::Snapshot(snapshot)).await;
            }
            "orderbook_delta" => {
                let delta: OrderbookDelta = serde_json::from_value(ws_msg.msg)?;
                let _ = tx.send(KalshiWsEvent::Delta(delta)).await;
            }
            "error" => {
                tracing::warn!("kalshi WS error: {:?}", ws_msg.msg);
            }
            _ => {
                tracing::trace!(msg_type = ws_msg.msg_type, "unhandled WS message type");
            }
        }
        Ok(())
    }
}
```

**Step 2: Update kalshi/mod.rs**

```rust
pub mod auth;
pub mod rest;
pub mod types;
pub mod ws;
```

**Step 3: Verify it compiles**

Run: `cd kalshi-arb && cargo build`

**Step 4: Commit**

```bash
git add kalshi-arb/src/kalshi/
git commit -m "feat: add Kalshi WebSocket client with orderbook subscriptions"
```

---

## Task 6: Odds feed trait + odds-api.io REST implementation

**Files:**
- Create: `kalshi-arb/src/feed/mod.rs`
- Create: `kalshi-arb/src/feed/types.rs`
- Create: `kalshi-arb/src/feed/odds_api_io.rs`
- Modify: `kalshi-arb/src/main.rs`

**Step 1: Write feed/types.rs**

```rust
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct OddsUpdate {
    pub event_id: String,
    pub sport: String,
    pub home_team: String,
    pub away_team: String,
    pub commence_time: String,
    pub bookmakers: Vec<BookmakerOdds>,
}

#[derive(Debug, Clone)]
pub struct BookmakerOdds {
    pub name: String,
    pub home_odds: f64,
    pub away_odds: f64,
    pub last_update: String,
}

/// odds-api.io REST response types
#[derive(Debug, Deserialize)]
pub struct OddsApiEvent {
    pub id: String,
    pub sport_key: String,
    pub home_team: String,
    pub away_team: String,
    pub commence_time: String,
    pub bookmakers: Vec<OddsApiBookmaker>,
}

#[derive(Debug, Deserialize)]
pub struct OddsApiBookmaker {
    pub key: String,
    pub title: String,
    pub last_update: String,
    pub markets: Vec<OddsApiMarket>,
}

#[derive(Debug, Deserialize)]
pub struct OddsApiMarket {
    pub key: String,
    pub outcomes: Vec<OddsApiOutcome>,
}

#[derive(Debug, Deserialize)]
pub struct OddsApiOutcome {
    pub name: String,
    pub price: f64,
}
```

**Step 2: Write feed/mod.rs with trait**

```rust
pub mod odds_api_io;
pub mod types;

use anyhow::Result;
use async_trait::async_trait;
use types::OddsUpdate;

#[async_trait]
pub trait OddsFeed: Send + Sync {
    async fn fetch_odds(&mut self, sport: &str) -> Result<Vec<OddsUpdate>>;
}
```

**Step 3: Write feed/odds_api_io.rs**

```rust
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
```

**Step 4: Update main.rs to add feed module**

Add `mod feed;` to main.rs imports.

**Step 5: Verify it compiles**

Run: `cd kalshi-arb && cargo build`

**Step 6: Commit**

```bash
git add kalshi-arb/src/feed/
git commit -m "feat: add odds feed trait and odds-api.io REST implementation"
```

---

## Task 7: Engine core — fee calc, devig, strategy

**Files:**
- Create: `kalshi-arb/src/engine/mod.rs`
- Create: `kalshi-arb/src/engine/fees.rs`
- Create: `kalshi-arb/src/engine/strategy.rs`
- Create: `kalshi-arb/src/engine/matcher.rs`
- Create: `kalshi-arb/src/engine/risk.rs`

**Step 1: Write engine/fees.rs**

Port the BigInt fee calculation from `KalshiMath.js`:

```rust
/// Kalshi fee calculation using integer math to avoid floating-point errors.
///
/// Taker rate: 7% → fee = ceil(7 * Q * P * (100-P) / 10_000)
/// Maker rate: 1.75% → fee = ceil(175 * Q * P * (100-P) / 1_000_000)
pub fn calculate_fee(price_cents: u32, quantity: u32, is_taker: bool) -> u32 {
    if quantity == 0 || price_cents == 0 || price_cents >= 100 {
        return 0;
    }
    let p = price_cents as u64;
    let q = quantity as u64;
    let spread_factor = p * (100 - p);

    if is_taker {
        let numerator = 7 * q * spread_factor;
        let denominator = 10_000u64;
        ((numerator + denominator - 1) / denominator) as u32
    } else {
        let numerator = 175 * q * spread_factor;
        let denominator = 1_000_000u64;
        ((numerator + denominator - 1) / denominator) as u32
    }
}

/// Find minimum sell price to break even after exit fees.
pub fn break_even_sell_price(total_entry_cost_cents: u32, quantity: u32, is_taker_exit: bool) -> u32 {
    for price in 1..=99u32 {
        let fee = calculate_fee(price, quantity, is_taker_exit);
        let gross = price * quantity;
        if gross >= fee + total_entry_cost_cents {
            return price;
        }
    }
    100 // impossible to break even
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_taker_fee_at_50_cents() {
        // 7 * 10 * 50 * 50 / 10_000 = 175 → ceil = 175
        assert_eq!(calculate_fee(50, 10, true), 175);
    }

    #[test]
    fn test_maker_fee_at_50_cents() {
        // 175 * 10 * 50 * 50 / 1_000_000 = 4.375 → ceil = 5
        assert_eq!(calculate_fee(50, 10, false), 5);
    }

    #[test]
    fn test_fee_at_boundaries() {
        assert_eq!(calculate_fee(0, 10, true), 0);
        assert_eq!(calculate_fee(100, 10, true), 0);
        assert_eq!(calculate_fee(50, 0, true), 0);
    }

    #[test]
    fn test_single_contract_taker() {
        // 7 * 1 * 50 * 50 / 10_000 = 17.5 → ceil = 18
        assert_eq!(calculate_fee(50, 1, true), 18);
    }

    #[test]
    fn test_break_even() {
        // Bought 1 contract at 50¢, taker fee = 18¢ → total cost = 68¢
        let entry_cost = 50 + calculate_fee(50, 1, true); // 68
        let be = break_even_sell_price(entry_cost, 1, true);
        // Verify break even is correct
        let exit_fee = calculate_fee(be, 1, true);
        assert!(be * 1 >= entry_cost + exit_fee);
    }
}
```

**Step 2: Write engine/strategy.rs**

```rust
use super::fees::calculate_fee;

/// Result of strategy evaluation for a single market.
#[derive(Debug, Clone)]
pub struct StrategySignal {
    pub action: TradeAction,
    pub price: u32,
    pub edge: i32,
    pub net_profit_estimate: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TradeAction {
    TakerBuy,
    MakerBuy { bid_price: u32 },
    Skip,
}

/// Evaluate whether to trade a market.
///
/// `fair_value`: vig-free probability * 100 (cents)
/// `best_bid`: best bid on Kalshi orderbook (cents)
/// `best_ask`: best ask on Kalshi orderbook (cents)
pub fn evaluate(
    fair_value: u32,
    best_bid: u32,
    best_ask: u32,
    taker_threshold: u8,
    maker_threshold: u8,
    min_edge_after_fees: u8,
) -> StrategySignal {
    if best_ask == 0 || fair_value == 0 {
        return StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge: 0,
            net_profit_estimate: 0,
        };
    }

    let edge = fair_value as i32 - best_ask as i32;

    if edge < maker_threshold as i32 {
        return StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge,
            net_profit_estimate: 0,
        };
    }

    // Calculate net profit for taker buy + maker sell at fair value
    let entry_fee_taker = calculate_fee(best_ask, 1, true) as i32;
    let exit_fee_maker = calculate_fee(fair_value, 1, false) as i32;
    let taker_profit = fair_value as i32 - best_ask as i32 - entry_fee_taker - exit_fee_maker;

    // Calculate net profit for maker buy at bid+1 + maker sell at fair value
    let maker_buy_price = best_bid.saturating_add(1).min(99);
    let entry_fee_maker = calculate_fee(maker_buy_price, 1, false) as i32;
    let maker_profit = fair_value as i32 - maker_buy_price as i32 - entry_fee_maker - exit_fee_maker;

    if edge >= taker_threshold as i32 && taker_profit >= min_edge_after_fees as i32 {
        StrategySignal {
            action: TradeAction::TakerBuy,
            price: best_ask,
            edge,
            net_profit_estimate: taker_profit,
        }
    } else if edge >= maker_threshold as i32 && maker_profit >= min_edge_after_fees as i32 {
        StrategySignal {
            action: TradeAction::MakerBuy { bid_price: maker_buy_price },
            price: maker_buy_price,
            edge,
            net_profit_estimate: maker_profit,
        }
    } else {
        StrategySignal {
            action: TradeAction::Skip,
            price: 0,
            edge,
            net_profit_estimate: 0,
        }
    }
}

/// Convert American odds to implied probability.
/// Positive odds (e.g., +150): prob = 100 / (odds + 100)
/// Negative odds (e.g., -150): prob = |odds| / (|odds| + 100)
pub fn american_to_probability(odds: f64) -> f64 {
    if odds > 0.0 {
        100.0 / (odds + 100.0)
    } else {
        let abs = odds.abs();
        abs / (abs + 100.0)
    }
}

/// Devig two-way odds to get fair probabilities.
/// Returns (home_fair_prob, away_fair_prob).
pub fn devig(home_odds: f64, away_odds: f64) -> (f64, f64) {
    let home_implied = american_to_probability(home_odds);
    let away_implied = american_to_probability(away_odds);
    let total = home_implied + away_implied;
    if total == 0.0 {
        return (0.5, 0.5);
    }
    (home_implied / total, away_implied / total)
}

/// Compute fair value in cents from devigged probability.
pub fn fair_value_cents(probability: f64) -> u32 {
    (probability * 100.0).round().clamp(1.0, 99.0) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_american_to_probability() {
        let prob = american_to_probability(-150.0);
        assert!((prob - 0.6).abs() < 0.001);

        let prob = american_to_probability(150.0);
        assert!((prob - 0.4).abs() < 0.001);
    }

    #[test]
    fn test_devig() {
        let (home, away) = devig(-150.0, 130.0);
        assert!((home + away - 1.0).abs() < 0.001);
        assert!(home > 0.5); // favorite
    }

    #[test]
    fn test_fair_value_cents() {
        assert_eq!(fair_value_cents(0.60), 60);
        assert_eq!(fair_value_cents(0.0), 1);  // clamped
        assert_eq!(fair_value_cents(1.0), 99); // clamped
    }

    #[test]
    fn test_evaluate_taker_buy() {
        let signal = evaluate(65, 58, 60, 5, 2, 1);
        assert_eq!(signal.action, TradeAction::TakerBuy);
        assert_eq!(signal.price, 60);
        assert_eq!(signal.edge, 5);
    }

    #[test]
    fn test_evaluate_maker_buy() {
        let signal = evaluate(63, 58, 60, 5, 2, 1);
        assert!(matches!(signal.action, TradeAction::MakerBuy { .. }));
    }

    #[test]
    fn test_evaluate_skip() {
        let signal = evaluate(61, 58, 60, 5, 2, 1);
        assert_eq!(signal.action, TradeAction::Skip);
    }
}
```

**Step 3: Write engine/matcher.rs**

Port team normalization from `marketIndexing.js`:

```rust
use std::collections::HashMap;
use chrono::NaiveDate;

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub struct MarketKey {
    pub sport: String,
    pub date: NaiveDate,
    pub teams: [String; 2], // sorted alphabetically
}

#[derive(Debug, Clone)]
pub struct IndexedMarket {
    pub ticker: String,
    pub title: String,
    pub is_inverse: bool,
    pub best_bid: u32,
    pub best_ask: u32,
}

/// Normalizes a team name by stripping mascots and keeping location.
pub fn normalize_team(name: &str) -> String {
    let mut s = name.to_uppercase();
    s = s.replace("SAINT", "ST");
    s = s.replace('&', "AND");
    s = s.replace('.', "");

    // Common mascots/suffixes to strip
    let suffixes = [
        "MAVERICKS", "JAZZ", "HAWKS", "CELTICS", "PISTONS", "PACERS", "HEAT",
        "THUNDER", "WARRIORS", "SUNS", "LAKERS", "CLIPPERS", "BLAZERS", "KINGS",
        "SPURS", "GRIZZLIES", "PELICANS", "ROCKETS", "TIMBERWOLVES", "NUGGETS",
        "BUCKS", "BULLS", "CAVALIERS", "RAPTORS", "NETS", "KNICKS", "WIZARDS",
        "HORNETS", "MAGIC", "TRAIL BLAZERS", "76ERS", "SIXERS",
        // NFL
        "PACKERS", "BEARS", "LIONS", "VIKINGS", "COWBOYS", "GIANTS", "EAGLES",
        "COMMANDERS", "BUCCANEERS", "SAINTS", "FALCONS", "PANTHERS", "RAMS",
        "SEAHAWKS", "49ERS", "NINERS", "CARDINALS", "RAVENS", "BENGALS",
        "BROWNS", "STEELERS", "TEXANS", "COLTS", "JAGUARS", "TITANS", "BRONCOS",
        "CHIEFS", "RAIDERS", "CHARGERS", "BILLS", "DOLPHINS", "PATRIOTS", "JETS",
        // NHL
        "BRUINS", "SABRES", "RED WINGS", "BLACKHAWKS", "AVALANCHE", "BLUE JACKETS",
        "WILD", "PREDATORS", "BLUES", "FLAMES", "OILERS", "CANUCKS", "DUCKS",
        "COYOTES", "GOLDEN KNIGHTS", "KRAKEN", "SHARKS", "HURRICANES", "LIGHTNING",
        "CAPITALS", "FLYERS", "PENGUINS", "RANGERS", "ISLANDERS", "DEVILS",
        "MAPLE LEAFS", "SENATORS", "CANADIENS",
        // MLB
        "RED SOX", "YANKEES", "ORIOLES", "RAYS", "WHITE SOX", "GUARDIANS",
        "TIGERS", "ROYALS", "TWINS", "ASTROS", "ANGELS", "ATHLETICS", "MARINERS",
        "BRAVES", "MARLINS", "METS", "PHILLIES", "NATIONALS", "CUBS", "REDS",
        "BREWERS", "PIRATES", "DIAMONDBACKS", "ROCKIES", "DODGERS", "PADRES",
    ];

    for suffix in &suffixes {
        if let Some(pos) = s.rfind(suffix) {
            let before = &s[..pos].trim_end();
            if !before.is_empty() {
                s = before.to_string();
                break;
            }
        }
    }

    // Remove all spaces and non-alphanumeric
    s.retain(|c| c.is_ascii_alphanumeric());
    s.truncate(20);
    s
}

/// Generate a deterministic market key.
pub fn generate_key(sport: &str, team1: &str, team2: &str, date: NaiveDate) -> Option<MarketKey> {
    let n1 = normalize_team(team1);
    let n2 = normalize_team(team2);
    if n1.is_empty() || n2.is_empty() {
        return None;
    }
    let mut teams = [n1, n2];
    teams.sort();
    Some(MarketKey {
        sport: sport.to_uppercase().chars().filter(|c| c.is_ascii_alphabetic()).collect(),
        date,
        teams,
    })
}

/// Parse date from Kalshi event ticker.
/// Format: "KXNBAGAME-26JAN19LACWAS" → 2026-01-19
pub fn parse_date_from_ticker(ticker: &str) -> Option<NaiveDate> {
    // Find the YYMMMDD pattern after a dash
    let re_pattern: Vec<u8> = ticker.bytes().collect();
    for part in ticker.split('-').skip(1) {
        if part.len() >= 7 {
            let year_str = &part[0..2];
            let month_str = &part[2..5];
            let day_str = &part[5..7];

            if let (Ok(year), Ok(day)) = (year_str.parse::<i32>(), day_str.parse::<u32>()) {
                let month = match month_str {
                    "JAN" => Some(1), "FEB" => Some(2), "MAR" => Some(3),
                    "APR" => Some(4), "MAY" => Some(5), "JUN" => Some(6),
                    "JUL" => Some(7), "AUG" => Some(8), "SEP" => Some(9),
                    "OCT" => Some(10), "NOV" => Some(11), "DEC" => Some(12),
                    _ => None,
                };
                if let Some(m) = month {
                    return NaiveDate::from_ymd_opt(2000 + year, m, day);
                }
            }
        }
    }
    None
}

/// Parse Kalshi title: "Team1 at Team2 Winner?" → (away, home)
pub fn parse_kalshi_title(title: &str) -> Option<(String, String)> {
    let lower = title.to_lowercase();
    let (away, home) = if let Some(pos) = lower.find(" at ") {
        let away = &title[..pos];
        let rest = &title[pos + 4..];
        let home = rest.trim_end_matches(" Winner?").trim_end_matches('?');
        (away.to_string(), home.to_string())
    } else if let Some(pos) = lower.find(" vs ") {
        let away = &title[..pos];
        let rest = &title[pos + 4..];
        let home = rest.trim_end_matches(" Winner?").trim_end_matches('?');
        (away.to_string(), home.to_string())
    } else {
        return None;
    };
    Some((away, home))
}

pub type MarketIndex = HashMap<MarketKey, IndexedMarket>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_team() {
        assert_eq!(normalize_team("Dallas Mavericks"), "DALLAS");
        assert_eq!(normalize_team("Los Angeles Lakers"), "LOSANGELES");
        assert_eq!(normalize_team("New York Knicks"), "NEWYORK");
        assert_eq!(normalize_team("Oklahoma City Thunder"), "OKLAHOMACITY");
    }

    #[test]
    fn test_generate_key_sorted() {
        let d = NaiveDate::from_ymd_opt(2026, 1, 19).unwrap();
        let k1 = generate_key("NBA", "Lakers", "Celtics", d).unwrap();
        let k2 = generate_key("NBA", "Celtics", "Lakers", d).unwrap();
        assert_eq!(k1, k2); // same regardless of order
    }

    #[test]
    fn test_parse_date_from_ticker() {
        let d = parse_date_from_ticker("KXNBAGAME-26JAN19LACWAS").unwrap();
        assert_eq!(d, NaiveDate::from_ymd_opt(2026, 1, 19).unwrap());
    }

    #[test]
    fn test_parse_kalshi_title() {
        let (away, home) = parse_kalshi_title("Dallas Mavericks at Los Angeles Lakers Winner?").unwrap();
        assert_eq!(away, "Dallas Mavericks");
        assert_eq!(home, "Los Angeles Lakers");
    }
}
```

**Step 4: Write engine/risk.rs**

```rust
use crate::config::RiskConfig;
use std::collections::HashMap;

pub struct RiskManager {
    config: RiskConfig,
    positions: HashMap<String, u32>, // ticker → contract count
}

impl RiskManager {
    pub fn new(config: RiskConfig) -> Self {
        Self {
            config,
            positions: HashMap::new(),
        }
    }

    /// Check if we can open a new position.
    pub fn can_trade(&self, ticker: &str, quantity: u32, cost_cents: u32) -> bool {
        let current = self.positions.get(ticker).copied().unwrap_or(0);
        if current + quantity > self.config.max_contracts_per_market {
            return false;
        }
        if self.positions.len() as u32 >= self.config.max_concurrent_markets
            && !self.positions.contains_key(ticker)
        {
            return false;
        }
        let total_exposure: u64 = self.positions.values().map(|&q| q as u64 * 100).sum::<u64>()
            + cost_cents as u64;
        if total_exposure > self.config.max_total_exposure_cents {
            return false;
        }
        true
    }

    pub fn record_buy(&mut self, ticker: &str, quantity: u32) {
        *self.positions.entry(ticker.to_string()).or_insert(0) += quantity;
    }

    pub fn record_sell(&mut self, ticker: &str, quantity: u32) {
        if let Some(pos) = self.positions.get_mut(ticker) {
            *pos = pos.saturating_sub(quantity);
            if *pos == 0 {
                self.positions.remove(ticker);
            }
        }
    }

    pub fn position_count(&self, ticker: &str) -> u32 {
        self.positions.get(ticker).copied().unwrap_or(0)
    }

    pub fn total_markets(&self) -> usize {
        self.positions.len()
    }
}
```

**Step 5: Write engine/mod.rs**

```rust
pub mod fees;
pub mod matcher;
pub mod risk;
pub mod strategy;
```

**Step 6: Update main.rs**

Add `mod engine;` to imports.

**Step 7: Run tests**

Run: `cd kalshi-arb && cargo test`
Expected: All fee, strategy, matcher, and devig tests pass.

**Step 8: Commit**

```bash
git add kalshi-arb/src/engine/
git commit -m "feat: add engine core — fees, strategy, matcher, risk manager"
```

---

## Task 8: TUI dashboard with ratatui

**Files:**
- Create: `kalshi-arb/src/tui/mod.rs`
- Create: `kalshi-arb/src/tui/state.rs`
- Create: `kalshi-arb/src/tui/render.rs`

**Step 1: Write tui/state.rs — shared app state**

```rust
use std::collections::VecDeque;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct AppState {
    pub balance_cents: i64,
    pub total_exposure_cents: i64,
    pub realized_pnl_cents: i64,
    pub kalshi_ws_connected: bool,
    pub odds_ws_connected: bool,
    pub start_time: Instant,
    pub is_paused: bool,
    pub markets: Vec<MarketRow>,
    pub positions: Vec<PositionRow>,
    pub trades: VecDeque<TradeRow>,
    pub logs: VecDeque<LogEntry>,
}

#[derive(Debug, Clone)]
pub struct MarketRow {
    pub ticker: String,
    pub fair_value: u32,
    pub bid: u32,
    pub ask: u32,
    pub edge: i32,
    pub action: String,
    pub latency_ms: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct PositionRow {
    pub ticker: String,
    pub quantity: u32,
    pub entry_price: u32,
    pub sell_price: u32,
    pub unrealized_pnl: i32,
}

#[derive(Debug, Clone)]
pub struct TradeRow {
    pub time: String,
    pub action: String,
    pub ticker: String,
    pub price: u32,
    pub quantity: u32,
    pub order_type: String,
    pub pnl: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct LogEntry {
    pub time: String,
    pub level: String,
    pub message: String,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            balance_cents: 0,
            total_exposure_cents: 0,
            realized_pnl_cents: 0,
            kalshi_ws_connected: false,
            odds_ws_connected: false,
            start_time: Instant::now(),
            is_paused: false,
            markets: Vec::new(),
            positions: Vec::new(),
            trades: VecDeque::with_capacity(100),
            logs: VecDeque::with_capacity(200),
        }
    }

    pub fn push_log(&mut self, level: &str, message: String) {
        let time = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        if self.logs.len() >= 200 {
            self.logs.pop_front();
        }
        self.logs.push_back(LogEntry {
            time,
            level: level.to_string(),
            message,
        });
    }

    pub fn push_trade(&mut self, trade: TradeRow) {
        if self.trades.len() >= 100 {
            self.trades.pop_front();
        }
        self.trades.push_back(trade);
    }

    pub fn uptime(&self) -> String {
        let secs = self.start_time.elapsed().as_secs();
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        format!("{}h {:02}m", h, m)
    }
}
```

**Step 2: Write tui/render.rs**

```rust
use super::state::AppState;
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Cell, Paragraph, Row, Table},
    Frame,
};

pub fn draw(f: &mut Frame, state: &AppState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),  // header
            Constraint::Min(8),    // markets
            Constraint::Length(6), // positions
            Constraint::Length(6), // trades
            Constraint::Min(5),   // logs
            Constraint::Length(1), // footer
        ])
        .split(f.area());

    draw_header(f, state, chunks[0]);
    draw_markets(f, state, chunks[1]);
    draw_positions(f, state, chunks[2]);
    draw_trades(f, state, chunks[3]);
    draw_logs(f, state, chunks[4]);
    draw_footer(f, state, chunks[5]);
}

fn draw_header(f: &mut Frame, state: &AppState, area: Rect) {
    let kalshi_status = if state.kalshi_ws_connected {
        Span::styled("CONNECTED", Style::default().fg(Color::Green))
    } else {
        Span::styled("DISCONNECTED", Style::default().fg(Color::Red))
    };

    let pause_status = if state.is_paused {
        Span::styled(" PAUSED", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))
    } else {
        Span::styled(" RUNNING", Style::default().fg(Color::Green))
    };

    let line = Line::from(vec![
        Span::raw(format!(
            " Balance: ${:.2}  |  Exposure: ${:.2}  |  P&L: ",
            state.balance_cents as f64 / 100.0,
            state.total_exposure_cents as f64 / 100.0,
        )),
        Span::styled(
            format!("${:.2}", state.realized_pnl_cents as f64 / 100.0),
            Style::default().fg(if state.realized_pnl_cents >= 0 {
                Color::Green
            } else {
                Color::Red
            }),
        ),
        Span::raw("  |  Kalshi: "),
        kalshi_status,
        Span::raw(format!("  |  Uptime: {}", state.uptime())),
        pause_status,
    ]);

    let block = Block::default()
        .title(" Kalshi Arb Engine ")
        .borders(Borders::ALL);
    let para = Paragraph::new(line).block(block);
    f.render_widget(para, area);
}

fn draw_markets(f: &mut Frame, state: &AppState, area: Rect) {
    let header = Row::new(vec!["Ticker", "Fair", "Bid", "Ask", "Edge", "Action", "Latency"])
        .style(Style::default().add_modifier(Modifier::BOLD));

    let rows: Vec<Row> = state
        .markets
        .iter()
        .map(|m| {
            let edge_color = if m.edge > 0 { Color::Green } else { Color::Red };
            Row::new(vec![
                Cell::from(m.ticker.clone()),
                Cell::from(m.fair_value.to_string()),
                Cell::from(m.bid.to_string()),
                Cell::from(m.ask.to_string()),
                Cell::from(format!("{:+}", m.edge))
                    .style(Style::default().fg(edge_color)),
                Cell::from(m.action.clone()),
                Cell::from(
                    m.latency_ms
                        .map(|l| format!("{}ms", l))
                        .unwrap_or_else(|| "--".to_string()),
                ),
            ])
        })
        .collect();

    let table = Table::new(
        rows,
        [
            Constraint::Percentage(25),
            Constraint::Length(5),
            Constraint::Length(5),
            Constraint::Length(5),
            Constraint::Length(6),
            Constraint::Length(8),
            Constraint::Length(8),
        ],
    )
    .header(header)
    .block(
        Block::default()
            .title(" Live Markets ")
            .borders(Borders::ALL),
    );

    f.render_widget(table, area);
}

fn draw_positions(f: &mut Frame, state: &AppState, area: Rect) {
    let header = Row::new(vec!["Ticker", "Qty", "Entry", "Sell @", "P&L"])
        .style(Style::default().add_modifier(Modifier::BOLD));

    let rows: Vec<Row> = state
        .positions
        .iter()
        .map(|p| {
            let pnl_color = if p.unrealized_pnl >= 0 { Color::Green } else { Color::Red };
            Row::new(vec![
                Cell::from(p.ticker.clone()),
                Cell::from(p.quantity.to_string()),
                Cell::from(format!("{}c", p.entry_price)),
                Cell::from(format!("{}c", p.sell_price)),
                Cell::from(format!("{:+}c", p.unrealized_pnl))
                    .style(Style::default().fg(pnl_color)),
            ])
        })
        .collect();

    let table = Table::new(
        rows,
        [
            Constraint::Percentage(30),
            Constraint::Length(5),
            Constraint::Length(8),
            Constraint::Length(8),
            Constraint::Length(8),
        ],
    )
    .header(header)
    .block(
        Block::default()
            .title(" Open Positions ")
            .borders(Borders::ALL),
    );

    f.render_widget(table, area);
}

fn draw_trades(f: &mut Frame, state: &AppState, area: Rect) {
    let lines: Vec<Line> = state
        .trades
        .iter()
        .rev()
        .take(4)
        .map(|t| {
            let pnl = t
                .pnl
                .map(|p| format!(" {:+}c", p))
                .unwrap_or_default();
            Line::from(format!(
                " {} {} {}x {} @ {}c ({}){}",
                t.time, t.action, t.quantity, t.ticker, t.price, t.order_type, pnl
            ))
        })
        .collect();

    let block = Block::default()
        .title(" Recent Trades ")
        .borders(Borders::ALL);
    let para = Paragraph::new(lines).block(block);
    f.render_widget(para, area);
}

fn draw_logs(f: &mut Frame, state: &AppState, area: Rect) {
    let lines: Vec<Line> = state
        .logs
        .iter()
        .rev()
        .take(area.height.saturating_sub(2) as usize)
        .map(|l| {
            let color = match l.level.as_str() {
                "ERROR" => Color::Red,
                "WARN" => Color::Yellow,
                "TRADE" => Color::Cyan,
                _ => Color::DarkGray,
            };
            Line::from(vec![
                Span::styled(
                    format!(" {} [{}] ", l.time, l.level),
                    Style::default().fg(color),
                ),
                Span::raw(&l.message),
            ])
        })
        .collect();

    let block = Block::default()
        .title(" Engine Log ")
        .borders(Borders::ALL);
    let para = Paragraph::new(lines).block(block);
    f.render_widget(para, area);
}

fn draw_footer(f: &mut Frame, _state: &AppState, area: Rect) {
    let line = Line::from(vec![
        Span::styled("  [q]", Style::default().fg(Color::Yellow)),
        Span::raw("uit  "),
        Span::styled("[p]", Style::default().fg(Color::Yellow)),
        Span::raw("ause  "),
        Span::styled("[r]", Style::default().fg(Color::Yellow)),
        Span::raw("esume  "),
    ]);
    let para = Paragraph::new(line);
    f.render_widget(para, area);
}
```

**Step 3: Write tui/mod.rs — event loop**

```rust
pub mod render;
pub mod state;

use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
    ExecutableCommand,
};
use ratatui::prelude::*;
use state::AppState;
use std::io::stdout;
use std::time::Duration;
use tokio::sync::watch;

/// Commands the TUI can send back to the engine.
#[derive(Debug, Clone)]
pub enum TuiCommand {
    Quit,
    Pause,
    Resume,
}

/// Run the TUI. Reads state from `state_rx`, sends commands on `cmd_tx`.
pub async fn run_tui(
    state_rx: watch::Receiver<AppState>,
    cmd_tx: tokio::sync::mpsc::Sender<TuiCommand>,
) -> Result<()> {
    enable_raw_mode()?;
    stdout().execute(EnterAlternateScreen)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;

    let result = tui_loop(&mut terminal, state_rx, cmd_tx).await;

    disable_raw_mode()?;
    stdout().execute(LeaveAlternateScreen)?;

    result
}

async fn tui_loop(
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    mut state_rx: watch::Receiver<AppState>,
    cmd_tx: tokio::sync::mpsc::Sender<TuiCommand>,
) -> Result<()> {
    loop {
        let state = state_rx.borrow().clone();
        terminal.draw(|f| render::draw(f, &state))?;

        // Poll for keyboard events with 100ms timeout
        if event::poll(Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('q') => {
                            let _ = cmd_tx.send(TuiCommand::Quit).await;
                            return Ok(());
                        }
                        KeyCode::Char('p') => {
                            let _ = cmd_tx.send(TuiCommand::Pause).await;
                        }
                        KeyCode::Char('r') => {
                            let _ = cmd_tx.send(TuiCommand::Resume).await;
                        }
                        _ => {}
                    }
                }
            }
        }

        // Check if state has changed
        let _ = state_rx.changed().await;
    }
}
```

**Step 4: Update main.rs**

Add `mod tui;` to imports.

**Step 5: Verify it compiles**

Run: `cd kalshi-arb && cargo build`

**Step 6: Commit**

```bash
git add kalshi-arb/src/tui/
git commit -m "feat: add TUI dashboard with ratatui"
```

---

## Task 9: Wire everything together in main.rs

**Files:**
- Modify: `kalshi-arb/src/main.rs`

**Step 1: Write the full main.rs**

```rust
mod config;
mod engine;
mod feed;
mod kalshi;
mod tui;

use anyhow::Result;
use config::Config;
use engine::{matcher, risk::RiskManager, strategy};
use feed::{odds_api_io::OddsApiIo, OddsFeed};
use kalshi::{auth::KalshiAuth, rest::KalshiRest, ws::KalshiWs};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, watch};
use tui::state::{AppState, MarketRow};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("kalshi_arb=info")
        .init();

    let config = Config::load(Path::new("config.toml"))?;
    tracing::info!("loaded configuration");

    // Load API keys from environment
    let kalshi_api_key = Config::kalshi_api_key()?;
    let kalshi_pk_path = Config::kalshi_private_key_path()?;
    let odds_api_key = Config::odds_api_key()?;

    let pk_pem = std::fs::read_to_string(&kalshi_pk_path)?;
    let auth = Arc::new(KalshiAuth::new(kalshi_api_key, &pk_pem)?);
    let rest = Arc::new(KalshiRest::new(auth.clone(), &config.kalshi.api_base));

    // Channels
    let (state_tx, state_rx) = watch::channel(AppState::new());
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<tui::TuiCommand>(16);
    let (kalshi_ws_tx, mut kalshi_ws_rx) = mpsc::channel(512);

    // --- Phase 1: Fetch Kalshi markets and build index ---
    let sport_series = vec![
        ("americanfootball_nfl", "KXNFLGAME"),
        ("basketball_nba", "KXNBAGAME"),
        ("baseball_mlb", "KXMLBGAME"),
        ("icehockey_nhl", "KXNHLGAME"),
    ];

    let mut market_index: matcher::MarketIndex = HashMap::new();
    let mut all_tickers: Vec<String> = Vec::new();

    for (sport, series) in &sport_series {
        match rest.get_markets_by_series(series).await {
            Ok(markets) => {
                for m in &markets {
                    if let Some((away, home)) = matcher::parse_kalshi_title(&m.title) {
                        let date = m
                            .expected_expiration_time
                            .as_deref()
                            .or(m.close_time.as_deref())
                            .and_then(|ts| {
                                chrono::DateTime::parse_from_rfc3339(ts)
                                    .ok()
                                    .map(|dt| dt.date_naive())
                            })
                            .or_else(|| matcher::parse_date_from_ticker(&m.event_ticker));

                        if let Some(date) = date {
                            if let Some(key) = matcher::generate_key(sport, &away, &home, date) {
                                market_index.insert(
                                    key,
                                    matcher::IndexedMarket {
                                        ticker: m.ticker.clone(),
                                        title: m.title.clone(),
                                        is_inverse: false,
                                        best_bid: m.yes_bid,
                                        best_ask: m.yes_ask,
                                    },
                                );
                                all_tickers.push(m.ticker.clone());
                            }
                        }
                    }
                }
                tracing::info!(sport, count = markets.len(), "indexed Kalshi markets");
            }
            Err(e) => {
                tracing::warn!(sport, error = %e, "failed to fetch Kalshi markets");
            }
        }
    }

    tracing::info!(total = market_index.len(), "market index built");

    // --- Phase 2: Spawn Kalshi WebSocket ---
    let kalshi_ws = KalshiWs::new(auth.clone(), &config.kalshi.ws_url);
    let ws_tickers = all_tickers.clone();
    tokio::spawn(async move {
        if let Err(e) = kalshi_ws.run(ws_tickers, kalshi_ws_tx).await {
            tracing::error!("kalshi WS fatal: {:#}", e);
        }
    });

    // --- Phase 3: Spawn odds polling loop ---
    let mut odds_feed = OddsApiIo::new(odds_api_key, &config.odds_feed.base_url);
    let odds_sports = config.odds_feed.sports.clone();
    let strategy_config = config.strategy.clone();
    let risk_config = config.risk.clone();
    let rest_for_engine = rest.clone();

    let state_tx_engine = state_tx.clone();
    tokio::spawn(async move {
        let mut risk_mgr = RiskManager::new(risk_config);
        let mut is_paused = false;

        loop {
            if is_paused {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            }

            let cycle_start = Instant::now();
            let mut market_rows: Vec<MarketRow> = Vec::new();

            for sport in &odds_sports {
                match odds_feed.fetch_odds(sport).await {
                    Ok(updates) => {
                        for update in updates {
                            // Devig using first bookmaker with valid odds
                            if let Some(bm) = update.bookmakers.first() {
                                let (home_fv, away_fv) =
                                    strategy::devig(bm.home_odds, bm.away_odds);
                                let home_cents = strategy::fair_value_cents(home_fv);
                                let away_cents = strategy::fair_value_cents(away_fv);

                                // Try to match home team
                                let date = chrono::DateTime::parse_from_rfc3339(
                                    &update.commence_time,
                                )
                                .ok()
                                .map(|dt| dt.date_naive());

                                if let Some(date) = date {
                                    if let Some(key) = matcher::generate_key(
                                        sport,
                                        &update.home_team,
                                        &update.away_team,
                                        date,
                                    ) {
                                        if let Some(mkt) = market_index.get(&key) {
                                            let fair = home_cents;
                                            let signal = strategy::evaluate(
                                                fair,
                                                mkt.best_bid,
                                                mkt.best_ask,
                                                strategy_config.taker_edge_threshold,
                                                strategy_config.maker_edge_threshold,
                                                strategy_config.min_edge_after_fees,
                                            );

                                            let action_str = match &signal.action {
                                                strategy::TradeAction::TakerBuy => "TAKER",
                                                strategy::TradeAction::MakerBuy { .. } => "MAKER",
                                                strategy::TradeAction::Skip => "SKIP",
                                            };

                                            market_rows.push(MarketRow {
                                                ticker: mkt.ticker.clone(),
                                                fair_value: fair,
                                                bid: mkt.best_bid,
                                                ask: mkt.best_ask,
                                                edge: signal.edge,
                                                action: action_str.to_string(),
                                                latency_ms: Some(
                                                    cycle_start.elapsed().as_millis() as u64,
                                                ),
                                            });

                                            // Execute if actionable
                                            if signal.action != strategy::TradeAction::Skip
                                                && risk_mgr.can_trade(
                                                    &mkt.ticker,
                                                    1,
                                                    signal.price,
                                                )
                                            {
                                                let order =
                                                    kalshi::types::CreateOrderRequest {
                                                        ticker: mkt.ticker.clone(),
                                                        action: "buy".to_string(),
                                                        side: "yes".to_string(),
                                                        count: 1,
                                                        order_type: "limit".to_string(),
                                                        yes_price: Some(signal.price),
                                                        no_price: None,
                                                        client_order_id: None,
                                                    };
                                                match rest_for_engine
                                                    .create_order(&order)
                                                    .await
                                                {
                                                    Ok(resp) => {
                                                        risk_mgr.record_buy(&mkt.ticker, 1);
                                                        tracing::info!(
                                                            ticker = mkt.ticker,
                                                            price = signal.price,
                                                            edge = signal.edge,
                                                            "order placed"
                                                        );
                                                    }
                                                    Err(e) => {
                                                        tracing::warn!(
                                                            "order failed: {:#}",
                                                            e
                                                        );
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(sport, error = %e, "odds fetch failed");
                    }
                }
            }

            // Sort by edge descending
            market_rows.sort_by(|a, b| b.edge.cmp(&a.edge));

            // Update TUI state
            state_tx_engine.send_modify(|state| {
                state.markets = market_rows;
            });

            // Poll interval: 10s for free tier rate limiting
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        }
    });

    // --- Phase 4: Process Kalshi WS events (update orderbook) ---
    let state_tx_ws = state_tx.clone();
    tokio::spawn(async move {
        while let Some(event) = kalshi_ws_rx.recv().await {
            match event {
                kalshi::ws::KalshiWsEvent::Connected => {
                    state_tx_ws.send_modify(|s| {
                        s.kalshi_ws_connected = true;
                        s.push_log("INFO", "Kalshi WS connected".to_string());
                    });
                }
                kalshi::ws::KalshiWsEvent::Disconnected(reason) => {
                    state_tx_ws.send_modify(|s| {
                        s.kalshi_ws_connected = false;
                        s.push_log("WARN", format!("Kalshi WS disconnected: {}", reason));
                    });
                }
                kalshi::ws::KalshiWsEvent::Snapshot(snap) => {
                    state_tx_ws.send_modify(|s| {
                        s.push_log(
                            "INFO",
                            format!("Orderbook snapshot: {}", snap.market_ticker),
                        );
                    });
                }
                kalshi::ws::KalshiWsEvent::Delta(delta) => {
                    state_tx_ws.send_modify(|s| {
                        s.push_log(
                            "INFO",
                            format!(
                                "Delta: {} {} {:+} @ {}c",
                                delta.market_ticker, delta.side, delta.delta, delta.price
                            ),
                        );
                    });
                }
            }
        }
    });

    // --- Phase 5: Run TUI (blocks until quit) ---
    tui::run_tui(state_rx, cmd_tx).await?;

    tracing::info!("shutting down");
    Ok(())
}
```

**Step 2: Verify it compiles**

Run: `cd kalshi-arb && cargo build`

**Step 3: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat: wire all subsystems together in main event loop"
```

---

## Task 10: Integration test — verify full build and run dry test

**Step 1: Run all unit tests**

Run: `cd kalshi-arb && cargo test`
Expected: All tests pass.

**Step 2: Run clippy for lint checks**

Run: `cd kalshi-arb && cargo clippy -- -D warnings`
Expected: No warnings.

**Step 3: Verify binary builds in release mode**

Run: `cd kalshi-arb && cargo build --release`
Expected: Compiles successfully. Binary at `target/release/kalshi-arb`.

**Step 4: Commit any fixes**

```bash
git add -A kalshi-arb/
git commit -m "chore: fix clippy warnings and verify release build"
```

---

## Summary

| Task | Component | What it does |
|------|-----------|--------------|
| 1 | Scaffold | Cargo project with all deps |
| 2 | Config | TOML parsing + env var secrets |
| 3 | Kalshi Auth | RSA-PSS request signing |
| 4 | Kalshi REST | Markets, orders, portfolio endpoints |
| 5 | Kalshi WS | Orderbook subscriptions + delta processing |
| 6 | Odds Feed | Trait abstraction + odds-api.io REST impl |
| 7 | Engine Core | Fees, devig, strategy, matcher, risk |
| 8 | TUI | ratatui dashboard with live state |
| 9 | Main | Wire all subsystems with channels |
| 10 | Integration | Tests, clippy, release build |
