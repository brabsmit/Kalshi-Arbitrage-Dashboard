# Scraped Odds Feed (Bovada) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Bovada as a third NCAAB odds source via their public JSON API, implementing the existing `OddsFeed` trait.

**Architecture:** Bovada exposes a public REST endpoint at `/services/sports/event/coupon/events/A/description/basketball/college-basketball` that returns structured JSON with events, competitors, and moneyline odds. No headless browser needed — a simple `reqwest` HTTP client (same pattern as DraftKings feed) handles everything. The new `ScrapedOddsFeed` implements `OddsFeed` and plugs into the existing pipeline unchanged.

**Tech Stack:** Rust, reqwest (already in Cargo.toml), serde, async-trait, tokio

---

### Task 1: Add `max_retries` to `OddsSourceConfig`

**Files:**
- Modify: `src/config.rs:52-68`
- Test: `src/config.rs` (existing `test_new_config_parses`)

**Step 1: Add field to `OddsSourceConfig`**

In `src/config.rs`, add the `max_retries` field after `request_timeout_ms`:

```rust
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
```

Add the default function near the other defaults:

```rust
fn default_max_retries() -> u32 { 2 }
```

**Step 2: Run tests to verify nothing breaks**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo test config`
Expected: All config tests pass (the new field has a default, so existing TOML parses fine).

**Step 3: Commit**

```bash
git add src/config.rs
git commit -m "feat(config): add max_retries field to OddsSourceConfig"
```

---

### Task 2: Create Bovada response types and HTML parser

**Files:**
- Create: `src/feed/scraped.rs`

**Step 1: Write the Bovada JSON deserialization types and odds parser**

Create `src/feed/scraped.rs` with the response types matching the Bovada API JSON structure, and the `parse_bovada_odds` function that converts JSON text into `Vec<OddsUpdate>`:

```rust
//! Bovada sportsbook odds feed via their public JSON API.
//!
//! Endpoint: /services/sports/event/coupon/events/A/description/{sport}/{league}
//! Returns structured JSON with events, competitors, and moneyline odds.

use super::types::*;
use super::OddsFeed;
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use std::time::{Duration, Instant};

const BOVADA_BASE: &str = "https://www.bovada.lv/services/sports/event/coupon/events/A/description";

/// Map internal sport key to Bovada URL path segment.
fn bovada_sport_path(sport: &str) -> Option<&'static str> {
    match sport {
        "college-basketball" | "college-basketball-womens" => Some("basketball/college-basketball"),
        "basketball" => Some("basketball/nba"),
        "ice-hockey" => Some("hockey/nhl"),
        "baseball" => Some("baseball/mlb"),
        "mma" => Some("martial-arts/mma"),
        _ => None,
    }
}

// ── Bovada JSON response types ────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BovadaResponse {
    #[serde(default)]
    pub events: Vec<BovadaEvent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BovadaEvent {
    pub id: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub start_time: i64,
    #[serde(default)]
    pub live: bool,
    #[serde(default)]
    pub competitors: Vec<BovadaCompetitor>,
    #[serde(default)]
    pub display_groups: Vec<BovadaDisplayGroup>,
}

#[derive(Debug, Deserialize)]
pub struct BovadaCompetitor {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub home: bool,
}

#[derive(Debug, Deserialize)]
pub struct BovadaDisplayGroup {
    #[serde(default)]
    pub markets: Vec<BovadaMarket>,
}

#[derive(Debug, Deserialize)]
pub struct BovadaMarket {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub outcomes: Vec<BovadaOutcome>,
}

#[derive(Debug, Deserialize)]
pub struct BovadaOutcome {
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub price: BovadaPrice,
}

#[derive(Debug, Deserialize, Default)]
pub struct BovadaPrice {
    #[serde(default)]
    pub american: String,
}

// ── Parsing ───────────────────────────────────────────────────────────

/// Parse American odds string from Bovada: "-150", "+130", "EVEN".
fn parse_american_odds(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.eq_ignore_ascii_case("EVEN") {
        return Some(100.0);
    }
    s.parse::<f64>().ok()
}

/// Parse Bovada JSON response into `Vec<OddsUpdate>`.
/// Public for unit testing with fixtures.
pub fn parse_bovada_response(json: &str, sport: &str) -> Result<Vec<OddsUpdate>> {
    // Bovada returns an array of path-sections; take the first one with events.
    let sections: Vec<BovadaResponse> = serde_json::from_str(json)
        .context("failed to parse Bovada JSON")?;

    let now = chrono::Utc::now().to_rfc3339();
    let mut updates = Vec::new();

    for section in &sections {
        for event in &section.events {
            let home = event.competitors.iter().find(|c| c.home);
            let away = event.competitors.iter().find(|c| !c.home);
            let (Some(home), Some(away)) = (home, away) else { continue };

            // Find moneyline market (key "2W-12" = 2-way moneyline)
            let moneyline = event.display_groups.iter()
                .flat_map(|dg| &dg.markets)
                .find(|m| m.key == "2W-12");

            let Some(ml) = moneyline else { continue };
            if ml.outcomes.len() < 2 { continue }

            let home_odds = ml.outcomes.iter()
                .find(|o| o.description == home.name)
                .and_then(|o| parse_american_odds(&o.price.american));
            let away_odds = ml.outcomes.iter()
                .find(|o| o.description == away.name)
                .and_then(|o| parse_american_odds(&o.price.american));

            let (Some(h), Some(a)) = (home_odds, away_odds) else { continue };

            // Convert epoch millis to RFC3339
            let commence = chrono::DateTime::from_timestamp_millis(event.start_time)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default();

            updates.push(OddsUpdate {
                event_id: event.id.clone(),
                sport: sport.to_string(),
                home_team: home.name.clone(),
                away_team: away.name.clone(),
                commence_time: commence,
                bookmakers: vec![BookmakerOdds {
                    name: "Bovada".to_string(),
                    home_odds: h,
                    away_odds: a,
                    draw_odds: None,
                    last_update: now.clone(),
                }],
            });
        }
    }

    Ok(updates)
}

// ── OddsFeed implementation ──────────────────────────────────────────

pub struct ScrapedOddsFeed {
    client: Client,
    base_url: String,
    max_retries: u32,
    cached: Vec<OddsUpdate>,
}

impl ScrapedOddsFeed {
    pub fn new(base_url: &str, timeout_ms: u64, max_retries: u32) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .build()
            .expect("failed to build reqwest client");

        Self {
            client,
            base_url: base_url.to_string(),
            max_retries,
            cached: Vec::new(),
        }
    }

    fn build_url(&self, sport: &str) -> Option<String> {
        if self.base_url.starts_with("http") {
            // Full URL override from config
            Some(self.base_url.clone())
        } else {
            bovada_sport_path(sport).map(|path| format!("{}/{}", BOVADA_BASE, path))
        }
    }
}

#[async_trait]
impl OddsFeed for ScrapedOddsFeed {
    async fn fetch_odds(&mut self, sport: &str) -> Result<Vec<OddsUpdate>> {
        let url = self.build_url(sport)
            .with_context(|| format!("Bovada does not support sport: {}", sport))?;

        let mut last_err = None;
        for attempt in 0..=self.max_retries {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
            }

            match self.client.get(&url).send().await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        let status = resp.status();
                        let body = resp.text().await.unwrap_or_default();
                        last_err = Some(anyhow::anyhow!("Bovada HTTP {} : {}", status, body));
                        continue;
                    }
                    let text = resp.text().await.context("Bovada response read failed")?;
                    match parse_bovada_response(&text, sport) {
                        Ok(updates) if updates.is_empty() && !self.cached.is_empty() => {
                            tracing::warn!("Bovada returned 0 events, using cache");
                            return Ok(self.cached.clone());
                        }
                        Ok(updates) => {
                            self.cached = updates.clone();
                            return Ok(updates);
                        }
                        Err(e) => {
                            tracing::warn!(attempt, error = %e, "Bovada parse failed");
                            last_err = Some(e);
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(attempt, error = %e, "Bovada request failed");
                    last_err = Some(e.into());
                }
            }
        }

        // All retries exhausted — return cache if available
        if !self.cached.is_empty() {
            tracing::warn!("Bovada fetch exhausted retries, returning cached data");
            Ok(self.cached.clone())
        } else {
            Err(last_err.unwrap_or_else(|| anyhow::anyhow!("Bovada fetch failed")))
        }
    }

    fn last_quota(&self) -> Option<ApiQuota> {
        None // No API quota for Bovada
    }
}
```

**Step 2: Register the module in `src/feed/mod.rs`**

Add `pub mod scraped;` to `src/feed/mod.rs`:

```rust
pub mod draftkings;
pub mod scraped;
pub mod score_feed;
pub mod the_odds_api;
pub mod types;
```

**Step 3: Verify it compiles**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo check`
Expected: Compiles with maybe a dead_code warning on `ScrapedOddsFeed` (not yet used in main).

**Step 4: Commit**

```bash
git add src/feed/scraped.rs src/feed/mod.rs
git commit -m "feat(feed): add Bovada scraped odds feed with JSON API parser"
```

---

### Task 3: Unit tests for Bovada parser

**Files:**
- Modify: `src/feed/scraped.rs` (add tests module)

**Step 1: Write tests for `parse_american_odds` and `parse_bovada_response`**

Append to the bottom of `src/feed/scraped.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_american_odds_negative() {
        assert!((parse_american_odds("-150").unwrap() - (-150.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_american_odds_positive() {
        assert!((parse_american_odds("+130").unwrap() - 130.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_american_odds_even() {
        assert!((parse_american_odds("EVEN").unwrap() - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_american_odds_invalid() {
        assert!(parse_american_odds("").is_none());
        assert!(parse_american_odds("abc").is_none());
    }

    #[test]
    fn test_bovada_sport_path() {
        assert_eq!(bovada_sport_path("college-basketball"), Some("basketball/college-basketball"));
        assert_eq!(bovada_sport_path("basketball"), Some("basketball/nba"));
        assert_eq!(bovada_sport_path("curling"), None);
    }

    fn fixture_json() -> &'static str {
        r#"[{
            "path": [],
            "events": [
                {
                    "id": "21494924",
                    "description": "UC Riverside @ Boise State",
                    "startTime": 1738364400000,
                    "live": false,
                    "competitors": [
                        { "name": "Boise State", "home": true },
                        { "name": "UC Riverside", "home": false }
                    ],
                    "displayGroups": [{
                        "markets": [{
                            "key": "2W-12",
                            "outcomes": [
                                {
                                    "description": "Boise State",
                                    "price": { "american": "-3300" }
                                },
                                {
                                    "description": "UC Riverside",
                                    "price": { "american": "+1200" }
                                }
                            ]
                        }]
                    }]
                },
                {
                    "id": "21494925",
                    "description": "Duke @ North Carolina",
                    "startTime": 1738368000000,
                    "live": true,
                    "competitors": [
                        { "name": "North Carolina", "home": true },
                        { "name": "Duke", "home": false }
                    ],
                    "displayGroups": [{
                        "markets": [{
                            "key": "2W-12",
                            "outcomes": [
                                {
                                    "description": "North Carolina",
                                    "price": { "american": "+110" }
                                },
                                {
                                    "description": "Duke",
                                    "price": { "american": "-130" }
                                }
                            ]
                        }]
                    }]
                }
            ]
        }]"#
    }

    #[test]
    fn test_parse_bovada_response_basic() {
        let updates = parse_bovada_response(fixture_json(), "college-basketball").unwrap();
        assert_eq!(updates.len(), 2);
    }

    #[test]
    fn test_parse_bovada_response_teams() {
        let updates = parse_bovada_response(fixture_json(), "college-basketball").unwrap();
        let boise = &updates[0];
        assert_eq!(boise.home_team, "Boise State");
        assert_eq!(boise.away_team, "UC Riverside");
    }

    #[test]
    fn test_parse_bovada_response_odds() {
        let updates = parse_bovada_response(fixture_json(), "college-basketball").unwrap();
        let boise = &updates[0];
        let bm = &boise.bookmakers[0];
        assert_eq!(bm.name, "Bovada");
        assert!((bm.home_odds - (-3300.0)).abs() < f64::EPSILON);
        assert!((bm.away_odds - 1200.0).abs() < f64::EPSILON);
        assert!(bm.draw_odds.is_none());
    }

    #[test]
    fn test_parse_bovada_response_commence_time() {
        let updates = parse_bovada_response(fixture_json(), "college-basketball").unwrap();
        // 1738364400000 = 2025-01-31T19:00:00Z
        assert!(updates[0].commence_time.contains("2025-01-31"));
    }

    #[test]
    fn test_parse_bovada_response_sport() {
        let updates = parse_bovada_response(fixture_json(), "college-basketball").unwrap();
        assert_eq!(updates[0].sport, "college-basketball");
    }

    #[test]
    fn test_parse_bovada_response_event_id() {
        let updates = parse_bovada_response(fixture_json(), "college-basketball").unwrap();
        assert_eq!(updates[0].event_id, "21494924");
        assert_eq!(updates[1].event_id, "21494925");
    }

    #[test]
    fn test_parse_bovada_empty_events() {
        let json = r#"[{"path": [], "events": []}]"#;
        let updates = parse_bovada_response(json, "college-basketball").unwrap();
        assert!(updates.is_empty());
    }

    #[test]
    fn test_parse_bovada_missing_moneyline() {
        // Event has no 2W-12 market — should be skipped
        let json = r#"[{
            "path": [],
            "events": [{
                "id": "123",
                "description": "A @ B",
                "startTime": 1738364400000,
                "live": false,
                "competitors": [
                    { "name": "B", "home": true },
                    { "name": "A", "home": false }
                ],
                "displayGroups": [{
                    "markets": [{
                        "key": "SPREAD",
                        "outcomes": []
                    }]
                }]
            }]
        }]"#;
        let updates = parse_bovada_response(json, "college-basketball").unwrap();
        assert!(updates.is_empty());
    }

    #[test]
    fn test_parse_bovada_even_odds() {
        let json = r#"[{
            "path": [],
            "events": [{
                "id": "456",
                "description": "A @ B",
                "startTime": 1738364400000,
                "live": false,
                "competitors": [
                    { "name": "B", "home": true },
                    { "name": "A", "home": false }
                ],
                "displayGroups": [{
                    "markets": [{
                        "key": "2W-12",
                        "outcomes": [
                            { "description": "B", "price": { "american": "EVEN" } },
                            { "description": "A", "price": { "american": "EVEN" } }
                        ]
                    }]
                }]
            }]
        }]"#;
        let updates = parse_bovada_response(json, "college-basketball").unwrap();
        assert_eq!(updates.len(), 1);
        assert!((updates[0].bookmakers[0].home_odds - 100.0).abs() < f64::EPSILON);
    }

    /// Integration test: hits real Bovada API.
    /// Run with: cargo test bovada_live --ignored -- --nocapture
    #[tokio::test]
    #[ignore]
    async fn bovada_live_fetch() {
        let mut feed = ScrapedOddsFeed::new(
            "https://www.bovada.lv/services/sports/event/coupon/events/A/description/basketball/college-basketball",
            10000,
            2,
        );
        match feed.fetch_odds("college-basketball").await {
            Ok(updates) => {
                println!("Got {} NCAAB events from Bovada", updates.len());
                for u in &updates {
                    println!("  {} vs {} | {}", u.away_team, u.home_team,
                        u.bookmakers.first().map(|b| format!("home={} away={}", b.home_odds, b.away_odds)).unwrap_or_default());
                }
            }
            Err(e) => {
                println!("Bovada fetch error: {:#}", e);
            }
        }
    }
}
```

**Step 2: Run the tests**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo test scraped`
Expected: All unit tests pass.

**Step 3: Commit**

```bash
git add src/feed/scraped.rs
git commit -m "test(feed): add unit tests for Bovada JSON parser with fixture data"
```

---

### Task 4: Register "scraped" source type in main.rs

**Files:**
- Modify: `src/main.rs:478-505` (the odds source registration match)

**Step 1: Add the import and match arm**

At the top of `main.rs`, add the import alongside the existing feed imports. Find the line importing `DraftKingsFeed` and add `ScrapedOddsFeed`:

```rust
use feed::scraped::ScrapedOddsFeed;
```

In the `match source_config.source_type.as_str()` block (around line 478), add a new arm before the `other =>` catch-all:

```rust
            "scraped" => {
                let target_url = source_config.base_url.as_deref()
                    .unwrap_or("https://www.bovada.lv/services/sports/event/coupon/events/A/description/basketball/college-basketball");
                odds_sources.insert(
                    name.clone(),
                    Box::new(ScrapedOddsFeed::new(
                        target_url,
                        source_config.request_timeout_ms,
                        source_config.max_retries,
                    )),
                );
            }
```

Also find the `source_label` match (around line 540-553) and add a display label:

```rust
                    "scraped" => "BOVADA",
```

**Step 2: Verify it compiles**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo check`
Expected: Compiles cleanly.

**Step 3: Run all tests to verify no regressions**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo test`
Expected: All existing tests + new scraped tests pass.

**Step 4: Commit**

```bash
git add src/main.rs
git commit -m "feat(main): register 'scraped' Bovada odds source type"
```

---

### Task 5: Add Bovada config to config.toml

**Files:**
- Modify: `config.toml`

**Step 1: Add the scraped odds source section**

Add below the existing `[odds_sources.the-odds-api]` section:

```toml
[odds_sources.scraped-bovada]
type = "scraped"
base_url = "https://www.bovada.lv/services/sports/event/coupon/events/A/description/basketball/college-basketball"
live_poll_s = 5
pre_game_poll_s = 60
request_timeout_ms = 10000
max_retries = 2
```

**Step 2: Optionally update college-basketball sport to use Bovada**

If college-basketball should default to Bovada, update:

```toml
[sports.college-basketball]
odds_source = "scraped-bovada"
```

Or leave as `"the-odds-api"` and let users switch via config. This is a user preference.

**Step 3: Run the config parsing test**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo test test_config_file_parses`
Expected: PASS (the new TOML section parses cleanly into `OddsSourceConfig`).

**Step 4: Commit**

```bash
git add config.toml
git commit -m "feat(config): add scraped-bovada odds source configuration"
```

---

### Task 6: Update NCAAB data flow analysis

**Files:**
- Modify: `NCAAB_DATA_FLOW_ANALYSIS.md`

**Step 1: Add Bovada as a third data source section**

In the "REAL-WORLD NCAAB DATA SOURCES" section of the diagram and in the latency tables, add Bovada as a third source alongside ESPN scores and The Odds API. Key details to include:

- Endpoint: `bovada.lv/services/sports/event/coupon/events/A/description/basketball/college-basketball`
- Polling: 5s live, 60s pre-game
- Timeout: 10,000ms
- Retry: up to 2 retries with 500ms backoff
- Latency: ~200-800ms HTTP, <1ms parse
- Source type: `"scraped"` (Bovada public JSON API)

**Step 2: Commit**

```bash
git add kalshi-arb/NCAAB_DATA_FLOW_ANALYSIS.md
git commit -m "docs: add Bovada source to NCAAB data flow analysis"
```

---

### Task 7: Full integration test

**Step 1: Run the full test suite**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo test`
Expected: All tests pass.

**Step 2: Run the live integration test (manual)**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo test bovada_live --ignored -- --nocapture`
Expected: Prints NCAAB events from Bovada (or a connection error if not in US/VPN).

**Step 3: Build check**

Run: `cd /Users/bryan/Documents/GitHub/Kalshi-Arbitrage-Dashboard/kalshi-arb && cargo build --release`
Expected: Builds successfully.
