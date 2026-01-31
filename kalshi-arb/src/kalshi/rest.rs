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
            let mut url = format!(
                "{}/trade-api/v2/markets?series_ticker={}&limit=200&status=open",
                self.base_url, series_ticker
            );
            if let Some(ref c) = cursor {
                url.push_str(&format!("&cursor={}", c));
            }

            let resp = self.client.get(&url).send().await.context("GET markets failed")?;
            let status = resp.status();
            if !status.is_success() {
                let body = resp.text().await.unwrap_or_default();
                anyhow::bail!("GET markets failed ({}): {}", status, body);
            }

            let parsed: MarketsResponse = resp.json().await
                .context("failed to parse markets response")?;

            let done = parsed.markets.is_empty()
                || parsed.cursor.as_deref().is_none_or(|c| c.is_empty());
            all_markets.extend(parsed.markets);
            if done {
                break;
            }
            cursor = parsed.cursor;
        }

        Ok(all_markets)
    }

    /// Place an order.
    #[allow(dead_code)]
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
    #[allow(dead_code)]
    pub async fn get_positions(&self) -> Result<Vec<MarketPosition>> {
        let path = "/trade-api/v2/portfolio/positions";
        let url = format!("{}{}", self.base_url, path);
        let resp: PortfolioPositionsResponse = self.get_authed(&url, path).await?;
        Ok(resp.market_positions)
    }

    /// Pre-flight check: verify API key + signature auth works before starting WS.
    /// Calls the balance endpoint and checks for 401.
    pub async fn preflight_auth_check(&self) -> Result<()> {
        let path = "/trade-api/v2/portfolio/balance";
        let url = format!("{}{}", self.base_url, path);
        let headers = self.auth.headers("GET", path)?;
        let mut req = self.client.get(&url);
        for (k, v) in &headers {
            req = req.header(k, v);
        }
        let resp = req.send().await.context("Auth pre-flight request failed")?;
        let status = resp.status();
        if status.as_u16() == 401 {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!(
                "Authentication failed (401 Unauthorized).\n\
                 Possible causes:\n\
                 - API key does not match the private key (keys are generated as a pair)\n\
                 - Private key file has Windows line endings (\\r\\n) or BOM characters\n\
                 - System clock is significantly out of sync\n\
                 - API key has been revoked or expired on Kalshi\n\
                 Server response: {}",
                body
            );
        }
        if status.as_u16() == 403 {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!(
                "Authorization failed (403 Forbidden) — key is valid but lacks permissions.\n\
                 Server response: {}",
                body
            );
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Auth pre-flight failed ({}): {}", status, body);
        }
        Ok(())
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
}
