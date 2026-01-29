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
#[allow(dead_code)]
pub struct OrderResponse {
    pub order: Order,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
pub struct BalanceResponse {
    pub balance: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct PortfolioPositionsResponse {
    pub market_positions: Vec<MarketPosition>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct MarketPosition {
    pub ticker: String,
    pub market_exposure: i64,
    pub position: i64,
    #[serde(default)]
    pub resting_orders_count: u32,
}

/// WebSocket orderbook snapshot message
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
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
#[allow(dead_code)]
pub struct WsMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(default)]
    pub sid: u64,
    #[serde(default)]
    pub seq: u64,
    pub msg: serde_json::Value,
}
