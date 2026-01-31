use std::collections::{HashMap, VecDeque};
use std::time::Instant;

use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Default)]
pub struct FilterStats {
    pub live: usize,
    pub pre_game: usize,
    pub closed: usize,
}

#[derive(Debug, Clone)]
pub struct DiagnosticRow {
    pub sport: String,
    pub matchup: String,
    pub commence_time: String,
    pub game_status: String,
    pub kalshi_ticker: Option<String>,
    pub market_status: Option<String>,
    pub reason: String,
}

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
    pub position_focus: bool,
    pub position_scroll_offset: usize,
    pub trade_focus: bool,
    pub trade_scroll_offset: usize,
    pub sim_mode: bool,
    pub sim_balance_cents: i64,
    pub sim_positions: Vec<SimPosition>,
    pub sim_realized_pnl_cents: i64,
    pub api_requests_used: u64,
    pub api_requests_remaining: u64,
    pub api_burn_rate: f64,
    pub api_hours_remaining: f64,
    pub live_sports: Vec<String>,
    pub filter_stats: FilterStats,
    pub next_game_start: Option<DateTime<Utc>>,
    pub diagnostic_rows: Vec<DiagnosticRow>,
    pub diagnostic_snapshot: bool,
    pub diagnostic_focus: bool,
    pub diagnostic_scroll_offset: usize,
    pub live_book: HashMap<String, (u32, u32, u32, u32)>,
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
    pub momentum_score: f64,
    pub staleness_secs: Option<u64>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
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
    pub slippage: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct SimPosition {
    pub ticker: String,
    pub quantity: u32,
    pub entry_price: u32,
    pub sell_price: u32,
    pub entry_fee: u32,
    pub filled_at: Instant,
    pub signal_ask: u32,
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
            position_focus: false,
            position_scroll_offset: 0,
            trade_focus: false,
            trade_scroll_offset: 0,
            sim_mode: false,
            sim_balance_cents: 100_000,
            sim_positions: Vec::new(),
            sim_realized_pnl_cents: 0,
            api_requests_used: 0,
            api_requests_remaining: 0,
            api_burn_rate: 0.0,
            api_hours_remaining: 0.0,
            live_sports: Vec::new(),
            filter_stats: FilterStats::default(),
            next_game_start: None,
            diagnostic_rows: Vec::new(),
            diagnostic_snapshot: false,
            diagnostic_focus: false,
            diagnostic_scroll_offset: 0,
            live_book: HashMap::new(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_stats_default() {
        let state = AppState::new();
        assert_eq!(state.filter_stats.live, 0);
        assert_eq!(state.filter_stats.pre_game, 0);
        assert_eq!(state.filter_stats.closed, 0);
        assert!(state.next_game_start.is_none());
    }
}
