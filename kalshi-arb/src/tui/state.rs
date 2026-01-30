use std::collections::VecDeque;
use std::time::Instant;

#[derive(Debug, Clone)]
#[allow(dead_code)]
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
    pub log_focus: bool,
    pub log_scroll_offset: usize,
    pub market_focus: bool,
    pub market_scroll_offset: usize,
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
            log_focus: false,
            log_scroll_offset: 0,
            market_focus: false,
            market_scroll_offset: 0,
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

    #[allow(dead_code)]
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
