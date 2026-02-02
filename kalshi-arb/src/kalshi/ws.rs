use super::auth::KalshiAuth;
use super::types::{OrderbookDelta, OrderbookSnapshot, WsMessage};
use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
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
    pub async fn run(&self, tickers: Vec<String>, tx: mpsc::Sender<KalshiWsEvent>) -> Result<()> {
        let mut consecutive_auth_failures = 0u32;
        loop {
            match self.connect_and_listen(&tickers, &tx).await {
                Ok(()) => {
                    consecutive_auth_failures = 0;
                    tracing::warn!("kalshi WS closed cleanly, reconnecting...");
                }
                Err(e) => {
                    let err_str = format!("{:#}", e);
                    let is_auth = err_str.contains("401") || err_str.contains("Unauthorized");
                    if is_auth {
                        consecutive_auth_failures += 1;
                        tracing::error!(
                            "kalshi WS auth failure #{}: {:#}",
                            consecutive_auth_failures,
                            e
                        );
                        if consecutive_auth_failures >= 3 {
                            tracing::error!(
                                "3 consecutive WS auth failures — stopping reconnects. \
                                 Check API key/private key pair and system clock."
                            );
                            let _ = tx
                                .send(KalshiWsEvent::Disconnected(
                                    "Authentication failed repeatedly (401). Check credentials."
                                        .to_string(),
                                ))
                                .await;
                            return Err(e);
                        }
                    } else {
                        consecutive_auth_failures = 0;
                        tracing::error!("kalshi WS error: {:#}, reconnecting in 2s...", e);
                    }
                    let _ = tx
                        .send(KalshiWsEvent::Disconnected(format!("{:#}", e)))
                        .await;
                }
            }
            let delay = if consecutive_auth_failures > 0 { 5 } else { 2 };
            tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
        }
    }

    async fn connect_and_listen(
        &self,
        tickers: &[String],
        tx: &mpsc::Sender<KalshiWsEvent>,
    ) -> Result<()> {
        let path = "/trade-api/ws/v2";
        let auth_headers = self.auth.headers("GET", path)?;

        // Build request from URL (adds WS upgrade headers automatically),
        // then attach Kalshi auth headers
        let mut request = self
            .ws_url
            .as_str()
            .into_client_request()
            .context("failed to build WS request")?;
        for (k, v) in &auth_headers {
            request.headers_mut().insert(
                k.parse::<tokio_tungstenite::tungstenite::http::HeaderName>()
                    .map_err(|e| anyhow::anyhow!("invalid header name: {}", e))?,
                v.parse::<tokio_tungstenite::tungstenite::http::HeaderValue>()
                    .map_err(|e| anyhow::anyhow!("invalid header value: {}", e))?,
            );
        }

        let (ws_stream, _) = match tokio_tungstenite::connect_async(request).await {
            Ok(pair) => pair,
            Err(e) => {
                let err_str = format!("{:#}", e);
                if err_str.contains("401") || err_str.contains("Unauthorized") {
                    tracing::error!(
                        "WS auth rejected (401). Timestamp used: {}ms. \
                         Check: API key matches private key, system clock is accurate, \
                         key file has no Windows line-ending issues.",
                        KalshiAuth::timestamp_ms()
                    );
                    anyhow::bail!(
                        "WebSocket authentication failed (401 Unauthorized). \
                         The pre-flight REST check passed, so this may be a timing/clock issue. \
                         System timestamp: {}ms since epoch",
                        KalshiAuth::timestamp_ms()
                    );
                }
                return Err(anyhow::anyhow!(e).context("WS connection failed"));
            }
        };

        let (mut write, mut read) = ws_stream.split();
        tracing::debug!("kalshi WS connected");
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
                .send(Message::Text(sub.to_string()))
                .await
                .context("WS subscribe failed")?;
        }

        tracing::debug!(count = tickers.len(), "subscribed to tickers");

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
                    tracing::debug!("kalshi WS received close frame");
                    break;
                }
                _ => {}
            }
        }

        Ok(())
    }

    async fn handle_message(&self, text: &str, tx: &mpsc::Sender<KalshiWsEvent>) -> Result<()> {
        let ws_msg: WsMessage = serde_json::from_str(text).context("failed to parse WS message")?;

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
