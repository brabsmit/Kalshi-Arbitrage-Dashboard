# NCAAB Data Flow Analysis: Real-World Data to Maker/Taker Action

## Pipeline Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        REAL-WORLD NCAAB DATA SOURCES                                    │
│                                                                                         │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐ │
│  │  ESPN SCORES API   │  │ THE ODDS API(h2h) │  │ DRAFTKINGS SBOOK  │  │  BOVADA JSON API  │ │
│  │ (Primary for NCAAB)│  │ (4 bookmaker avg) │  │ (Direct odds)     │  │  (Scraped source)  │ │
│  │                    │  │                   │  │                   │  │                   │ │
│  │ Polls: 1s (live)   │  │ Polls: 20s (live) │  │ Polls: 3s (live)  │  │ Polls: 5s (live)  │ │
│  │        60s (pre)   │  │        120s (pre) │  │        30s (pre)  │  │        60s (pre)  │ │
│  │ Timeout: 5000ms    │  │ Timeout: ~5000ms  │  │ Timeout: ~5000ms  │  │ Timeout: 10000ms  │ │
│  └─────────┬──────────┘  └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘ │
│            │ ~100-500ms            │ ~200-800ms            │ ~100-400ms            │ ~200-800ms│
│            │ (HTTP GET)            │ (HTTP GET)            │ (HTTP GET)            │ (HTTP GET)│
└────────────┼───────────────────────┼──────────────────────┼───────────────────────┼───────────┘
             │                       │                      │                       │
             ▼                       ▼                      ▼                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                              INGESTION LAYER                                             │
│                                                                                          │
│  ┌─────────────────────────┐    ┌─────────────────────────────────────────────────────┐  │
│  │    ScorePoller::fetch() │    │            OddsFeed::fetch_odds()                   │  │
│  │  score_feed.rs:278      │    │  the_odds_api.rs / draftkings.rs / scraped.rs       │  │
│  │                         │    │                                                     │  │
│  │  • ETag caching (304)   │    │  • API quota tracking (x-requests-remaining)        │  │
│  │  • Primary/fallback     │    │  • Rate limiting + exponential backoff              │  │
│  │  • Failover after 3     │    │  • Commence time extraction                         │  │
│  │    consecutive failures │    │  • Bookmaker name capture                           │  │
│  │  • JSON → ScoreUpdate   │    │  • JSON → OddsUpdate                                │  │
│  │                         │    │                                                     │  │
│  │  Latency: <1ms parse    │    │  Latency: <1ms parse                                │  │
│  └────────────┬────────────┘    └────────────────────┬────────────────────────────────┘  │
│               │                                      │                                   │
│  ┌────────────▼────────────┐                         │                                   │
│  │  College Elapsed Recomp │                         │                                   │
│  │  pipeline.rs:272-278    │                         │                                   │
│  │                         │                         │                                   │
│  │  2 halves × 20 min      │                         │                                   │
│  │  OT: 5 min periods      │                         │                                   │
│  │  Latency: <0.1ms        │                         │                                   │
│  └────────────┬────────────┘                         │                                   │
└───────────────┼──────────────────────────────────────┼───────────────────────────────────┘
                │                                      │
                ▼                                      ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                           FAIR VALUE COMPUTATION                                         │
│                                                                                          │
│  ┌──────────────────────────────┐     ┌──────────────────────────────────────────────┐  │
│  │      SCORE-FEED PATH         │     │             ODDS-FEED PATH                   │  │
│  │                              │     │                                              │  │
│  │  WinProbTable::fair_value()  │     │  strategy::devig()                           │  │
│  │  win_prob.rs:97              │     │  strategy.rs:172                              │  │
│  │                              │     │                                              │  │
│  │  Model: Logistic function    │     │  1. american_to_probability() per side        │  │
│  │  P = 1/(1+exp(-k*adj_diff))  │     │  2. Sum implied probs (overround)            │  │
│  │                              │     │  3. Normalize to 100%                         │  │
│  │  NCAAB params:               │     │  4. fair_value_cents() → clamp(1,99)         │  │
│  │   home_advantage = 3.5 pts   │     │                                              │  │
│  │   k_start = 0.065            │     │  Example:                                    │  │
│  │   k_range = 0.25             │     │   Home -150 → 0.600 implied                  │  │
│  │   regulation_secs = 2400     │     │   Away +130 → 0.435 implied                  │  │
│  │   ot_k_start = 0.10          │     │   Total = 1.035 (3.5% vig)                   │  │
│  │   ot_k_range = 1.0           │     │   Home fair = 0.600/1.035 = 58¢              │  │
│  │                              │     │                                              │  │
│  │  k ramps cubically:          │     │  Latency: <0.01ms                            │  │
│  │  k = 0.065 + (t/80)³ × 0.25 │     │                                              │  │
│  │  80 buckets (2400s/30)       │     │                                              │  │
│  │                              │     │                                              │  │
│  │  Latency: <0.01ms            │     │                                              │  │
│  └──────────────┬───────────────┘     └──────────────────────┬───────────────────────┘  │
└─────────────────┼────────────────────────────────────────────┼───────────────────────────┘
                  │                                            │
                  └──────────────────┬─────────────────────────┘
                                     │ fair_value (1-99 cents)
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                            MARKET MATCHING                                               │
│                                                                                          │
│  matcher::find_match()  —  matcher.rs                                                    │
│                                                                                          │
│  1. Normalize team names (NCAAB-specific):                                               │
│     • Strip mascots: "Duke Blue Devils" → "DUKE"                                         │
│     • "Saint" → "ST": "Saint Peter's" → "STPETERS"                                      │
│     • Remove non-alphanumeric, cap at 20 chars                                           │
│     • Longest-suffix matching to prevent "EAGLES" matching "GOLDEN EAGLES"               │
│                                                                                          │
│  2. Generate game key: (sport, date, [team_a, team_b SORTED])                            │
│                                                                                          │
│  3. Lookup in MarketIndex (built at startup from Kalshi REST API)                        │
│     • Parse ticker: KXNCBAGAME-26JAN19DUKEUNC-DUKE                                       │
│     • Extract date + teams + winner side                                                 │
│                                                                                          │
│  4. Prefer home-side market; fallback to away with inverted bid/ask                      │
│                                                                                          │
│  Latency: <0.01ms (HashMap lookup)                                                       │
└──────────────────────────────────────────────┬───────────────────────────────────────────┘
                                               │ matched ticker + is_inverse
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                       KALSHI ORDERBOOK (WebSocket)                                       │
│                                                                                          │
│  Persistent WebSocket connection subscribed to all NCAAB tickers                         │
│  kalshi/ws.rs — receives real-time orderbook snapshots + deltas                          │
│                                                                                          │
│  LiveBook (Mutex<HashMap<String, DepthSnapshot>>)                                        │
│  → best_bid_ask() extracts (yes_bid, yes_ask, no_bid, no_ask)                            │
│                                                                                          │
│  Latency: ~0ms (in-memory read from mutex)                                               │
│  WS update latency: ~10-50ms from Kalshi servers                                        │
└──────────────────────────────────────────────┬───────────────────────────────────────────┘
                                               │ (bid, ask)
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                         MOMENTUM SCORING                                                 │
│                         momentum.rs                                                      │
│                                                                                          │
│  ┌────────────────────────────┐    ┌─────────────────────────────────────────────────┐   │
│  │   VelocityTracker          │    │   BookPressureTracker                           │   │
│  │   (10-window EMA)          │    │   (10-window bid/ask ratio)                     │   │
│  │                            │    │                                                 │   │
│  │   • Tracks fair-value Δ    │    │   • Ratio = bid_depth / ask_depth               │   │
│  │   • |Δ prob| / Δ time      │    │   • Level: (ratio-1)/2 × 50 (max 50)           │   │
│  │   • 10 pp/min = score 100  │    │   • Trend: Δ ratio/s × 50 (max 50)             │   │
│  │   • Skips stale duplicates │    │   • Combined: level + trend (max 100)           │   │
│  │                            │    │                                                 │   │
│  │   Latency: <0.01ms         │    │   Latency: <0.01ms                              │   │
│  └──────────┬─────────────────┘    └──────────────────────┬──────────────────────────┘   │
│             │                                             │                              │
│             ▼                                             ▼                              │
│         ┌──────────────────────────────────────────────────────┐                         │
│         │    MomentumScorer::composite()                       │                         │
│         │    momentum = 0.6 × velocity + 0.4 × book_pressure  │                         │
│         │                                                      │                         │
│         │    NCAAB note: bypass_for_score_signals = true       │                         │
│         │    → Score-feed path skips momentum gating entirely  │                         │
│         └──────────────────────┬───────────────────────────────┘                         │
└────────────────────────────────┼─────────────────────────────────────────────────────────┘
                                 │ momentum_score (0-100)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                      STRATEGY EVALUATION                                                 │
│                      strategy.rs:27-106                                                  │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                     │ │
│  │   edge = fair_value - best_ask                                                      │ │
│  │                                                                                     │ │
│  │   ┌──────────────────────────────────────────────────────────────────┐               │ │
│  │   │  If edge < maker_threshold (2¢):  → SKIP                       │               │ │
│  │   │                                                                  │               │ │
│  │   │  If edge >= taker_threshold (5¢):                               │               │ │
│  │   │    Kelly size: f* = (b×p - q) / b                               │               │ │
│  │   │    qty = floor(f* × 0.25 × bankroll / ask)                      │               │ │
│  │   │    taker_profit = (FV - ask) × qty - 7% entry - 1.75% exit      │               │ │
│  │   │    If taker_profit >= min_edge_after_fees (1¢): → TAKER BUY     │               │ │
│  │   │                                                                  │               │ │
│  │   │  Else if edge >= maker_threshold (2¢):                          │               │ │
│  │   │    maker_price = best_bid + 1                                    │               │ │
│  │   │    Kelly size on maker_price                                     │               │ │
│  │   │    maker_profit = (FV - maker_price) × qty - 1.75% both sides   │               │ │
│  │   │    If maker_profit >= min_edge_after_fees (1¢): → MAKER BUY     │               │ │
│  │   │                                                                  │               │ │
│  │   │  Else: → SKIP                                                   │               │ │
│  │   └──────────────────────────────────────────────────────────────────┘               │ │
│  │                                                                                     │ │
│  │  Latency: <0.01ms                                                                   │ │
│  └─────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐ │
│  │   MOMENTUM GATING (strategy.rs:116-156)                                             │ │
│  │   (Skipped for score-feed path when bypass_for_score_signals = true)                │ │
│  │                                                                                     │ │
│  │   momentum < 40  → SKIP  (edge without momentum support)                           │ │
│  │   40 ≤ momentum < 75  → cap at MAKER  (downgrade TAKER)                            │ │
│  │   momentum ≥ 75  → allow TAKER                                                     │ │
│  │                                                                                     │ │
│  │   STALENESS CHECK: if score data > 10s old → force SKIP                            │ │
│  └─────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────┬───────────────────────────────────────────┘
                                               │ StrategySignal { action, price, qty, edge }
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                        ORDER EXECUTION                                                   │
│                                                                                          │
│  ┌─────────────────────┐       ┌──────────────────────────────────────────────────────┐  │
│  │  SIMULATION MODE     │       │  LIVE MODE (currently dry-run logging only)          │  │
│  │  pipeline.rs:758-819 │       │  main.rs — logs "signal detected (dry run)"          │  │
│  │                      │       │                                                      │  │
│  │  • Track sim_balance │       │  Would call:                                         │  │
│  │  • Record position   │       │  POST /trade-api/v2/portfolio/orders                 │  │
│  │  • Calculate P&L     │       │  { ticker, side: YES, qty, price }                   │  │
│  │  • Track slippage    │       │  Auth: RSA-signed JWT                                │  │
│  │  • Break-even exit   │       │                                                      │  │
│  │                      │       │  Expected latency: 50-500ms                          │  │
│  │  Latency: <0.1ms     │       │  (network + Kalshi order matching)                   │  │
│  └──────────────────────┘       └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

## End-to-End Latency Budget

### Score-Feed Path (Primary for NCAAB Live Games)

| Step | Component | Typical Latency | Worst Case | Source File |
|------|-----------|----------------|------------|-------------|
| 1 | Real-world event occurs | — | — | — |
| 2 | ESPN API reflects score change | 1-5s | 15s | External |
| 3 | Score polling interval (live) | 0-1s | 1s | `pipeline.rs:256` |
| 4 | HTTP GET to ESPN + parse JSON | 100-500ms | 5000ms (timeout) | `score_feed.rs:278-369` |
| 5 | College elapsed recomputation | <0.1ms | <0.1ms | `score_feed.rs:58-70` |
| 6 | Win probability lookup (logistic) | <0.01ms | <0.01ms | `win_prob.rs:97-101` |
| 7 | Market matching (HashMap lookup) | <0.01ms | <0.01ms | `matcher.rs` |
| 8 | Orderbook read (mutex lock) | <0.01ms | 1ms | `pipeline.rs:650-659` |
| 9 | Momentum scoring | <0.01ms | <0.01ms | `momentum.rs:159-163` |
| 10 | Strategy evaluation + Kelly sizing | <0.01ms | <0.01ms | `strategy.rs:27-106` |
| 11 | Momentum gating | **BYPASSED** | — | `pipeline.rs:685` |
| 12 | Order submission (Kalshi REST) | 50-500ms | 2000ms | `kalshi/rest.rs` |
| **Total** | | **~1.2-7s** | **~23s** | |

### Odds-Feed Path (Alternative for NCAAB)

| Step | Component | Typical Latency | Worst Case | Source File |
|------|-----------|----------------|------------|-------------|
| 1 | Real-world event occurs | — | — | — |
| 2 | Sportsbooks adjust lines | 5-30s | 120s | External |
| 3 | Odds API polling interval (live) | 0-20s | 20s | `pipeline.rs:398-407` |
| 4 | HTTP GET to odds API + parse | 200-800ms | 5000ms | `the_odds_api.rs` |
| 5 | Devig calculation (normalize vig) | <0.01ms | <0.01ms | `strategy.rs:172-180` |
| 6 | Market matching (HashMap lookup) | <0.01ms | <0.01ms | `matcher.rs` |
| 7 | Orderbook read (mutex lock) | <0.01ms | 1ms | `pipeline.rs:650-659` |
| 8 | Momentum scoring | <0.01ms | <0.01ms | `momentum.rs:159-163` |
| 9 | Strategy evaluation + Kelly sizing | <0.01ms | <0.01ms | `strategy.rs:27-106` |
| 10 | Momentum gating | <0.01ms | <0.01ms | `strategy.rs:116-156` |
| 11 | Order submission (Kalshi REST) | 50-500ms | 2000ms | `kalshi/rest.rs` |
| **Total** | | **~5-52s** | **~147s** | |

### Bovada Scraped Path (Third NCAAB Source)

| Step | Component | Typical Latency | Worst Case | Source File |
|------|-----------|----------------|------------|-------------|
| 1 | Real-world event occurs | — | — | — |
| 2 | Bovada adjusts lines | 5-30s | 60s | External |
| 3 | Bovada polling interval (live) | 0-5s | 5s | `config.toml` (live_poll_s=5) |
| 4 | HTTP GET to Bovada JSON API + parse | 200-800ms | 10000ms (timeout) | `scraped.rs` |
| 5 | Retry on failure (up to 2 retries) | 0ms (success) | 2×500ms backoff | `scraped.rs` |
| 6 | Devig calculation (normalize vig) | <0.01ms | <0.01ms | `strategy.rs:172-180` |
| 7 | Market matching (HashMap lookup) | <0.01ms | <0.01ms | `matcher.rs` |
| 8 | Orderbook read (mutex lock) | <0.01ms | 1ms | `pipeline.rs:650-659` |
| 9 | Momentum scoring | <0.01ms | <0.01ms | `momentum.rs:159-163` |
| 10 | Strategy evaluation + Kelly sizing | <0.01ms | <0.01ms | `strategy.rs:27-106` |
| 11 | Momentum gating | <0.01ms | <0.01ms | `strategy.rs:116-156` |
| 12 | Order submission (Kalshi REST) | 50-500ms | 2000ms | `kalshi/rest.rs` |
| **Total** | | **~5-37s** | **~77s** | |

## Critical Path Analysis

### Where Time Is Spent

```
Score-Feed Path (best case ~1.2s):
├── 85% — Waiting: ESPN data propagation + polling interval
├── 10% — Network: HTTP round-trip to ESPN
├──  4% — Network: HTTP round-trip to Kalshi (order)
└──  1% — Compute: All in-memory operations combined

Odds-Feed Path (best case ~5s):
├── 95% — Waiting: Sportsbook line movement + polling interval
├──  4% — Network: HTTP round-trips
└──  1% — Compute: All in-memory operations combined

Bovada Path (best case ~5s):
├── 93% — Waiting: Bovada line movement + polling interval
├──  6% — Network: HTTP round-trips (Bovada + Kalshi)
└──  1% — Compute: All in-memory operations combined
```

### NCAAB-Specific Considerations

1. **College period structure** (`score_feed.rs:58-70`): 2 halves × 20 minutes, not 4 quarters × 12 minutes. The pipeline recomputes elapsed time at `pipeline.rs:272-278` every cycle for college sports.

2. **Higher home-court advantage** (`win_prob.rs`): NCAAB uses `home_advantage = 3.5` vs NBA's `2.5`, reflecting stronger home-court effect in college basketball.

3. **80 time buckets** vs NBA's 96: `regulation_secs = 2400` / 30s = 80 buckets. The logistic `k` ramps faster per bucket, meaning the model becomes decisive earlier in the game.

4. **OT threshold at period > 2** (`pipeline.rs:868`): For 2-half sports, OT begins at period 3 vs period 5 for 4-quarter sports.

5. **Team name normalization** (`matcher.rs:185-262`): College has hundreds of teams with mascot suffixes. The longest-suffix-wins algorithm prevents false matches (e.g., "Marquette Golden Eagles" vs "Eastern Michigan Eagles").

6. **Momentum bypass for score-feed**: When `bypass_for_score_signals = true` (default), the score-feed path skips momentum gating entirely at `pipeline.rs:685`. The rationale is that live score changes ARE momentum — the score itself is the signal.

## Key Decision Points

### When does the system choose TAKER vs MAKER?

```
                    edge = fair_value - best_ask

        edge < 2¢                   2¢ ≤ edge < 5¢              edge ≥ 5¢
           │                             │                          │
           ▼                             ▼                          ▼
         SKIP                     Calculate both:           Calculate both:
                                  taker_profit              taker_profit
                                  maker_profit              maker_profit
                                       │                          │
                                       ▼                          ▼
                                  maker_profit ≥ 1¢?        taker_profit ≥ 1¢?
                                  ┌──┴───┐                  ┌──┴───┐
                                 No     Yes                No     Yes
                                  │      │                  │      │
                                  ▼      ▼                  │      ▼
                                SKIP   MAKER                │   TAKER
                                                            │
                                                            ▼
                                                      maker_profit ≥ 1¢?
                                                      ┌──┴───┐
                                                     No     Yes
                                                      │      │
                                                      ▼      ▼
                                                    SKIP   MAKER
```

### Fee Impact on Decision

| Action | Entry Fee | Exit Fee | Example (10 contracts @ 50¢) |
|--------|-----------|----------|------------------------------|
| **Taker Buy** | 7% of notional | 1.75% of notional | Entry: 18¢, Exit: 5¢ = 23¢ total |
| **Maker Buy** | 1.75% of notional | 1.75% of notional | Entry: 5¢, Exit: 5¢ = 10¢ total |

The fee asymmetry (7% taker vs 1.75% maker) means the system strongly prefers maker orders when edge is moderate. A 3¢ edge that passes the maker threshold often fails the taker threshold after fees.

## Configuration Reference (NCAAB)

```toml
[sports.college-basketball]
enabled = true
kalshi_series = "KXNCBAGAME"
label = "NCAA Basketball"
fair_value = "score-feed"          # Use live scores, not odds
odds_source = "the-odds-api"       # Fallback odds source

[sports.college-basketball.score_feed]
primary_url = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard"
live_poll_s = 1                     # 1-second polling during live games
pre_game_poll_s = 60                # 1-minute polling before games start
failover_threshold = 3              # Switch to fallback after 3 failures
request_timeout_ms = 5000           # 5-second timeout per request

[sports.college-basketball.win_prob]
home_advantage = 3.5                # College home-court is stronger than NBA
k_start = 0.065                     # Logistic steepness at game start
k_range = 0.25                      # Additional steepness by end of regulation
ot_k_start = 0.10                   # OT starting steepness
ot_k_range = 1.0                    # OT ending steepness (very steep)
regulation_secs = 2400              # 2 × 20-minute halves

[sports.college-basketball.strategy]
taker_edge_threshold = 5            # 5¢ edge to take liquidity
maker_edge_threshold = 2            # 2¢ edge to provide liquidity
min_edge_after_fees = 1             # Must net at least 1¢ after all fees

[sports.college-basketball.momentum]
bypass_for_score_signals = true     # Score IS momentum for live games
velocity_window_size = 10           # 10-sample EMA window

# --- Bovada scraped odds source (third data source) ---

[odds_sources.scraped-bovada]
type = "scraped"                    # Triggers ScrapedOddsFeed in main.rs
base_url = "https://www.bovada.lv/services/sports/event/coupon/events/A/description/basketball/college-basketball"
live_poll_s = 5                     # 5-second polling during live games
pre_game_poll_s = 60                # 1-minute polling before games start
request_timeout_ms = 10000          # 10-second timeout (Bovada can be slow)
max_retries = 2                     # Retry up to 2 times with backoff
```
