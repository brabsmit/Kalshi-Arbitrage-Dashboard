# Kalshi Arbitrage Engine - Design Document

**Date:** 2026-01-29
**Status:** Draft
**Goal:** Build a low-latency Rust trading engine that exploits millisecond delays between sportsbook odds updates and Kalshi market reaction.

## Strategy

1. Receive real-time sportsbook odds via WebSocket (odds-api.io, upgradeable to premium feeds)
2. Compute vig-free "fair value" for each event
3. Compare fair value against Kalshi orderbook (also via WebSocket)
4. When edge exceeds threshold, buy undervalued contracts
5. Immediately place resting sell order at fair value
6. Profit from the spread as Kalshi prices converge to fair value

## Architecture

Single Rust binary with three concurrent subsystems connected by lock-free channels:

```
┌─────────────────────────────────────────────────────────┐
│                    RUST BINARY                          │
│                                                         │
│  ┌──────────────┐   mpsc    ┌──────────────────────┐   │
│  │ ODDS INGRESS │ ────────► │   STRATEGY ENGINE    │   │
│  │ (WebSocket   │           │                      │   │
│  │  to odds-    │           │ - Fair value calc    │   │
│  │  api.io)     │           │ - Edge detection     │   │
│  └──────────────┘           │ - Order decisions    │   │
│                             └──────────┬───────────┘   │
│  ┌──────────────┐                      │               │
│  │ KALSHI FEED  │ ────────►            │               │
│  │ (WebSocket   │   mpsc    ┌──────────▼───────────┐   │
│  │  orderbook)  │ ────────► │  EXECUTION ENGINE    │   │
│  └──────────────┘           │                      │   │
│                             │ - Order placement    │   │
│  ┌──────────────┐           │ - Position tracking  │   │
│  │   TUI        │ ◄──────  │ - Exit management    │   │
│  │ (ratatui)    │   watch   └──────────────────────┘   │
│  └──────────────┘                                      │
└─────────────────────────────────────────────────────────┘
```

**Design principles:**
- Event-driven, not polling. React to WebSocket pushes.
- Lock-free hot path. Channels between subsystems, no mutexes on critical path.
- Single binary. TUI, engine, connections all in one process.
- Pluggable odds feed via Rust trait.

## Critical Path: Odds Update to Order Placed

```
SPORTSBOOK ODDS UPDATE ARRIVES (WebSocket message)
         │
         ▼  (~0ms)
    1. PARSE: Deserialize JSON (simd-json, pre-allocated buffers)
         │
         ▼  (~0.01ms)
    2. DEVIG: American odds → implied probability → vig-free prob
         │
         ▼  (~0.01ms)
    3. FAIR VALUE: vig-free prob x 100 = fair value in cents
         │
         ▼  (~0.01ms)
    4. MATCH: HashMap<MarketKey, KalshiMarket> O(1) lookup
         │
         ▼  (~0.01ms)
    5. EDGE CHECK: fair_value - kalshi_best_ask
         │ (edge found!)
         ▼  (~0.01ms)
    6. ORDER: Build order, select taker vs maker based on edge size
         │
         ▼  (~1-5ms network)
    7. SEND: HTTP POST via pre-warmed HTTP/2 connection to Kalshi

Total internal latency: ~0.05ms
Total with network: ~1-5ms to Kalshi
```

**Speed optimizations:**
- No allocation on hot path. Pre-allocated structs, byte slice matching.
- Pre-warmed HTTP/2 connection to Kalshi (established at startup, kept alive).
- Pre-computed RSA-PSS auth refreshed on separate thread.
- simd-json for SIMD-accelerated JSON parsing.

## Strategy Engine

### Edge Calculation

```
INPUTS (per market, continuously updated):
  fair_value:    vig-free probability x 100 (cents)
  kalshi_bid:    best bid on Kalshi orderbook (cents)
  kalshi_ask:    best ask on Kalshi orderbook (cents)
  position:      current contracts held
  config:        thresholds from config file

CALCULATION:
  buy_edge  = fair_value - kalshi_ask
  sell_edge = kalshi_bid - fair_value
```

### Fee-Aware Entry Decision

```
FEE FORMULAS (Kalshi):
  taker_fee(price, qty) = ceil(7 x qty x price x (100 - price) / 10_000)
  maker_fee(price, qty) = ceil(175 x qty x price x (100 - price) / 1_000_000)

ENTRY LOGIC:
  net_cost_taker = kalshi_ask + taker_fee(kalshi_ask, 1)
  net_cost_maker = (kalshi_bid + 1) + maker_fee(kalshi_bid + 1, 1)
  exit_revenue   = fair_value - maker_fee(fair_value, 1)

  if buy_edge >= taker_edge_threshold (default 5c):
    -> TAKER BUY at ask (guaranteed fill, higher fee)
  elif buy_edge >= maker_edge_threshold (default 2c):
    -> MAKER BUY at bid+1 (cheaper fee, may not fill)
  else:
    -> SKIP (edge too thin after fees)
```

### Exit Strategy

Immediately after entry, place a resting SELL at fair_value (maker order). If fair value moves due to new odds update, adjust sell price.

## Market Matching

### Data Structures

```rust
// Normalized key for O(1) matching
struct MarketKey {
    sport: Sport,           // enum: NFL, NBA, MLB, NHL
    date: NaiveDate,        // game date
    teams: [TeamId; 2],     // sorted alphabetically
}

// Kalshi market state (updated via WebSocket)
struct KalshiMarket {
    ticker: String,
    best_bid: u8,           // cents 0-99
    best_ask: u8,           // cents 1-100
    volume: u32,
    is_inverse: bool,
    last_update: Instant,
}

// Indexed lookup: O(1) by normalized key
HashMap<MarketKey, KalshiMarket>
```

### Team Normalization

Same approach as current `marketIndexing.js`:
- Strip mascot names, normalize to uppercase location
- Static mapping: "Los Angeles Lakers" -> "LOSANGELES"
- Handle edge cases: "NY" vs "New York", "St. Louis", etc.

### Startup Flow

1. Fetch all Kalshi sports series via REST
2. Parse tickers to extract team names + dates
3. Build `HashMap<MarketKey, KalshiMarket>`
4. Subscribe to all tickers via Kalshi WebSocket
5. Subscribe to matching sports via odds-api.io WebSocket
6. Engine ready - react to incoming odds updates

## Configuration

```toml
[strategy]
taker_edge_threshold = 5    # cents - use taker for edges >= 5c
maker_edge_threshold = 2    # cents - use maker for edges 2-4c
min_edge_after_fees = 1     # cents - minimum net profit to trade

[risk]
max_contracts_per_market = 10
max_total_exposure_cents = 50000   # $500
max_concurrent_markets = 5

[execution]
maker_timeout_ms = 500      # cancel maker buy if unfilled after 500ms
stale_odds_threshold_ms = 5000  # ignore odds older than 5s

[kalshi]
api_base = "https://api.elections.kalshi.com"
ws_url = "wss://api.elections.kalshi.com/trade-api/ws/v2"
api_key = ""                # set via environment variable
private_key_path = ""       # path to PEM file

[odds_feed]
provider = "odds-api-io"    # swappable: "odds-api-io", "unabated", "opticodds"
api_key = ""                # set via environment variable
sports = ["nfl", "nba", "mlb", "nhl"]
```

## TUI Dashboard

```
┌─ Kalshi Arb Engine ──────────────────────────────────────────────┐
│ Balance: $1,234.56  | Exposure: $320.00  | P&L: +$45.23         │
│ Kalshi WS: CONNECTED | Odds WS: CONNECTED | Uptime: 2h 14m     │
├─ Live Markets ───────────────────────────────────────────────────┤
│ Ticker          | Fair | Bid | Ask | Edge | Action   | Latency  │
│ KXNBA-LAL-NYK  |  62  | 58  | 60  | +2c  | MAKER    | 12ms     │
│ KXMLB-NYY-BOS  |  45  | 40  | 42  | +3c  | RESTING  | 8ms      │
│ KXNFL-KC-BUF   |  71  | 68  | 70  | +1c  | SKIP     | --       │
├─ Open Positions ─────────────────────────────────────────────────┤
│ KXNBA-LAL-NYK  | Bought 5 @ 60c | Sell resting @ 62c | +$0.10  │
│ KXMLB-NYY-BOS  | Bought 3 @ 41c | Sell resting @ 45c | +$0.12  │
├─ Recent Trades ──────────────────────────────────────────────────┤
│ 14:23:01 BUY  5x KXNBA-LAL-NYK @ 60c (taker) fill: 2ms        │
│ 14:23:01 SELL 5x KXNBA-LAL-NYK @ 62c (maker, resting)         │
│ 14:20:15 SELL 3x KXNFL-KC-BUF  @ 71c FILLED +$0.09 net        │
├─ Engine Log ─────────────────────────────────────────────────────┤
│ 14:23:01.003 [TRADE] Edge 2c on LAL-NYK, taker buy @ 60        │
│ 14:23:00.991 [ODDS]  LAL -150 -> -155 (FanDuel) FV: 62c        │
│ 14:22:58.442 [KALSHI] LAL-NYK bid:58 ask:60 (ws update)        │
└──────────────────────────────────────────────────────────────────┘
  [q]uit  [p]ause  [r]esume  [c]onfig  [+/-] exposure limit
```

**TUI features:**
- Non-blocking rendering via `watch` channels (no mutexes)
- Keyboard controls: pause/resume, adjust thresholds, force close
- Latency tracking: end-to-end from odds update to order sent
- Color coding: green (profitable), red (losing), yellow (resting)
- Log scrollback: last 100 events with millisecond timestamps

## Project Structure

```
kalshi-arb/
├── Cargo.toml
├── config.toml
├── src/
│   ├── main.rs              # Entry point, tokio runtime, spawns tasks
│   ├── config.rs            # TOML config parsing
│   │
│   ├── feed/                # Odds feed abstraction
│   │   ├── mod.rs           # OddsFeed trait definition
│   │   ├── odds_api_io.rs   # odds-api.io WebSocket implementation
│   │   └── types.rs         # OddsUpdate, BookmakerOdds structs
│   │
│   ├── kalshi/              # Kalshi API integration
│   │   ├── mod.rs           # KalshiClient struct
│   │   ├── auth.rs          # RSA-PSS signing (ring crate)
│   │   ├── rest.rs          # Order placement, portfolio queries
│   │   ├── ws.rs            # WebSocket orderbook feed
│   │   └── types.rs         # KalshiMarket, Order, Position structs
│   │
│   ├── engine/              # Core trading logic
│   │   ├── mod.rs           # Engine struct, main event loop
│   │   ├── strategy.rs      # Fair value calc, edge detection
│   │   ├── matcher.rs       # MarketKey normalization, HashMap index
│   │   ├── risk.rs          # Position limits, exposure checks
│   │   └── fees.rs          # Kalshi fee calculation
│   │
│   ├── execution/           # Order management
│   │   ├── mod.rs           # ExecutionManager
│   │   ├── orders.rs        # Order lifecycle
│   │   └── positions.rs     # Position tracking, P&L
│   │
│   └── tui/                 # Terminal UI
│       ├── mod.rs           # App state, event handling
│       ├── layout.rs        # Panel layout
│       └── render.rs        # Draw functions
```

## Key Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| tokio | 1 | Async runtime (multi-threaded) |
| tokio-tungstenite | 0.21 | WebSocket client |
| reqwest | 0.12 | HTTP client (HTTP/2, connection pooling) |
| serde / serde_json | 1 | Serialization |
| simd-json | 0.13 | Fast JSON parsing (SIMD, hot path) |
| ring | 0.17 | RSA-PSS signing (faster than openssl) |
| ratatui | 0.26 | Terminal UI framework |
| crossterm | 0.27 | Terminal input/output |
| toml | 0.8 | Config file parsing |
| tracing | 0.1 | Structured logging |
| chrono | 0.4 | Date/time handling |
| rust_decimal | 1 | Precise decimal math for fees |

## Odds Feed Provider Strategy

**Phase 1 (Development):** odds-api.io free tier (WebSocket, claimed sub-100ms)
**Phase 2 (Validation):** Evaluate latency claims, compare against The Odds API for accuracy
**Phase 3 (Production):** Upgrade to Unabated ($500+/mo) or OpticOdds ($500-2k/mo) if edge is validated

The `OddsFeed` trait makes swapping providers a single file change:

```rust
#[async_trait]
trait OddsFeed: Send + Sync {
    async fn connect(&mut self) -> Result<()>;
    async fn subscribe(&mut self, sports: &[Sport]) -> Result<()>;
    async fn next_update(&mut self) -> Result<OddsUpdate>;
}
```

## Risk Considerations

- **Kalshi rate limits:** Unknown exact limits. Start conservative, increase.
- **Stale odds:** Reject any odds update older than 5s (configurable).
- **Position concentration:** Max contracts per market prevents overexposure.
- **Total exposure cap:** Hard limit on total capital at risk.
- **API failures:** Pause trading on any connection drop. Resume only after reconnect.
- **Fee changes:** Kalshi fee structure is hardcoded. Monitor for changes.
