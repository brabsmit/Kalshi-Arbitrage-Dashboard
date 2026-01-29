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
