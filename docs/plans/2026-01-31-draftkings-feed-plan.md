# DraftKings Live Feed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a DraftKings sportsbook scraper as an alternative/complementary odds source, selectable via config, to reduce latency and API quota burn.

**Architecture:** New `DraftKingsFeed` implements the existing `OddsFeed` trait, producing the same `OddsUpdate` structs. A config-driven `source_strategy` field controls which feed(s) are active. No changes to the devig, strategy, or evaluation pipeline.

**Tech Stack:** Rust, reqwest (already a dependency), serde/serde_json (already dependencies), async-trait, tokio, tracing.

---

### Task 1: Add `DraftKingsFeedConfig` to config

**Files:**
- Modify: `kalshi-arb/src/config.rs:106-115` (after `OddsFeedConfig`)
- Modify: `kalshi-arb/src/config.rs:8-24` (`Config` struct)
- Modify: `kalshi-arb/config.toml:34-40` (add new sections)

**Step 1: Add `source_strategy` field to `OddsFeedConfig`**

In `kalshi-arb/src/config.rs`, add `source_strategy` to `OddsFeedConfig`:

```rust
#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct OddsFeedConfig {
    pub provider: String,
    pub base_url: String,
    pub bookmakers: String,
    pub live_poll_interval_s: Option<u64>,
    pub pre_game_poll_interval_s: Option<u64>,
    pub quota_warning_threshold: Option<u64>,
    #[serde(default = "default_source_strategy")]
    pub source_strategy: String,
}

fn default_source_strategy() -> String {
    "the-odds-api".to_string()
}
```

**Step 2: Add `DraftKingsFeedConfig` struct**

Below `OddsFeedConfig` in the same file:

```rust
#[derive(Debug, Deserialize, Clone)]
pub struct DraftKingsFeedConfig {
    #[serde(default = "default_dk_live_poll")]
    pub live_poll_interval_s: u64,
    #[serde(default = "default_dk_pre_game_poll")]
    pub pre_game_poll_interval_s: u64,
    #[serde(default = "default_dk_timeout")]
    pub request_timeout_ms: u64,
}

fn default_dk_live_poll() -> u64 { 3 }
fn default_dk_pre_game_poll() -> u64 { 30 }
fn default_dk_timeout() -> u64 { 5000 }

impl Default for DraftKingsFeedConfig {
    fn default() -> Self {
        Self {
            live_poll_interval_s: 3,
            pre_game_poll_interval_s: 30,
            request_timeout_ms: 5000,
        }
    }
}
```

**Step 3: Add field to `Config` struct**

```rust
pub struct Config {
    // ... existing fields ...
    pub draftkings_feed: Option<DraftKingsFeedConfig>,
    // ... rest ...
}
```

**Step 4: Add default config section to `config.toml`**

Append after `[odds_feed]` section:

```toml
source_strategy = "the-odds-api"

# [draftkings_feed]
# live_poll_interval_s = 3
# pre_game_poll_interval_s = 30
# request_timeout_ms = 5000
```

**Step 5: Run tests to verify config still parses**

Run: `cd kalshi-arb && cargo test config::tests::test_config_parses -- --nocapture`
Expected: PASS (new fields have defaults so existing config.toml still parses)

**Step 6: Commit**

```bash
git add kalshi-arb/src/config.rs kalshi-arb/config.toml
git commit -m "feat(config): add source_strategy and DraftKingsFeedConfig"
```

---

### Task 2: Add DraftKings response types to `feed/types.rs`

**Files:**
- Modify: `kalshi-arb/src/feed/types.rs` (add DK-specific serde types after existing types)

**Step 1: Add DraftKings API response structs**

Append to `kalshi-arb/src/feed/types.rs` after the `ApiQuota` struct:

```rust
/// DraftKings sportsbook API response types.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DkResponse {
    pub event_group: Option<DkEventGroup>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DkEventGroup {
    #[serde(default)]
    pub events: Vec<DkEvent>,
    #[serde(default)]
    pub offer_categories: Vec<DkOfferCategory>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DkEvent {
    pub event_id: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub start_date: String,
    #[serde(default)]
    pub team_name1: Option<String>,
    #[serde(default)]
    pub team_name2: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DkOfferCategory {
    #[serde(default)]
    pub offer_category_id: u64,
    #[serde(default)]
    pub offers: Vec<Vec<DkOffer>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DkOffer {
    #[serde(default)]
    pub event_id: u64,
    #[serde(default)]
    pub outcomes: Vec<DkOutcome>,
    #[serde(default)]
    pub is_suspended: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DkOutcome {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub odds_american: String,
}
```

**Step 2: Verify it compiles**

Run: `cd kalshi-arb && cargo check`
Expected: OK (new types are just declarations, no usage yet)

**Step 3: Commit**

```bash
git add kalshi-arb/src/feed/types.rs
git commit -m "feat(feed): add DraftKings API response types"
```

---

### Task 3: Implement `DraftKingsFeed`

**Files:**
- Create: `kalshi-arb/src/feed/draftkings.rs`
- Modify: `kalshi-arb/src/feed/mod.rs` (add `pub mod draftkings;`)

**Step 1: Write the test**

At the bottom of the new `draftkings.rs` file, add unit tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dk_event_group_basketball() {
        assert_eq!(dk_event_group("basketball"), Some((42648, 487, 4518)));
    }

    #[test]
    fn test_dk_event_group_unknown() {
        assert_eq!(dk_event_group("baseball"), None);
    }

    #[test]
    fn test_parse_dk_odds_positive() {
        assert!((parse_american_odds("+150").unwrap() - 150.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_dk_odds_negative() {
        assert!((parse_american_odds("-180").unwrap() - (-180.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_dk_odds_even() {
        // DK sometimes shows "EVEN" for +100
        assert!((parse_american_odds("EVEN").unwrap() - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_dk_odds_invalid() {
        assert!(parse_american_odds("").is_none());
        assert!(parse_american_odds("abc").is_none());
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd kalshi-arb && cargo test feed::draftkings::tests -- --nocapture`
Expected: FAIL (module doesn't exist yet / functions not defined)

**Step 3: Implement the module**

Create `kalshi-arb/src/feed/draftkings.rs`:

```rust
use super::types::*;
use super::OddsFeed;
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use std::time::{Duration, Instant};

const DK_BASE_URL: &str = "https://sportsbook-nash.draftkings.com/sites/US-SB/api/v5/eventgroups";

pub struct DraftKingsFeed {
    client: Client,
    poll_interval: Duration,
    pre_game_poll_interval: Duration,
    last_fetch: Option<Instant>,
    last_etag: Option<String>,
}

/// Map internal sport key to DraftKings (event_group_id, category_id, subcategory_id).
/// Basketball only for now.
fn dk_event_group(sport: &str) -> Option<(u64, u64, u64)> {
    match sport {
        "basketball" => Some((42648, 487, 4518)),
        _ => None,
    }
}

/// Parse DraftKings American odds string to f64.
/// Handles "+150", "-180", "EVEN" (= +100).
fn parse_american_odds(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.eq_ignore_ascii_case("EVEN") {
        return Some(100.0);
    }
    s.parse::<f64>().ok()
}

impl DraftKingsFeed {
    pub fn new(config: &crate::config::DraftKingsFeedConfig) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_millis(config.request_timeout_ms))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .build()
            .expect("failed to build reqwest client");

        Self {
            client,
            poll_interval: Duration::from_secs(config.live_poll_interval_s),
            pre_game_poll_interval: Duration::from_secs(config.pre_game_poll_interval_s),
            last_fetch: None,
            last_etag: None,
        }
    }

    /// Build the URL for fetching moneyline odds for a sport.
    fn build_url(group_id: u64, category_id: u64, subcategory_id: u64) -> String {
        format!(
            "{}/{}/categories/{}/subcategories/{}",
            DK_BASE_URL, group_id, category_id, subcategory_id
        )
    }
}

#[async_trait]
impl OddsFeed for DraftKingsFeed {
    async fn fetch_odds(&mut self, sport: &str) -> Result<Vec<OddsUpdate>> {
        let (group_id, category_id, subcategory_id) = dk_event_group(sport)
            .with_context(|| format!("DraftKings does not support sport: {}", sport))?;

        // Rate-limit
        if let Some(last) = self.last_fetch {
            let elapsed = last.elapsed();
            if elapsed < self.poll_interval {
                tokio::time::sleep(self.poll_interval - elapsed).await;
            }
        }

        let url = Self::build_url(group_id, category_id, subcategory_id);

        let mut req = self.client.get(&url);
        if let Some(ref etag) = self.last_etag {
            req = req.header("If-None-Match", etag.as_str());
        }

        let resp = req.send().await.context("DraftKings request failed")?;
        self.last_fetch = Some(Instant::now());

        // Handle 304 Not Modified (unchanged since last ETag)
        if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
            return Ok(Vec::new());
        }

        // Handle rate limiting
        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            tracing::warn!("DraftKings 429 rate limited, backing off");
            self.poll_interval = Duration::from_secs(
                self.poll_interval.as_secs().saturating_mul(2).min(30)
            );
            anyhow::bail!("DraftKings rate limited (429)");
        }

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("DraftKings API error ({}): {}", status, body);
        }

        // Store ETag for next conditional GET
        if let Some(etag) = resp.headers().get("etag") {
            self.last_etag = etag.to_str().ok().map(|s| s.to_string());
        }

        let dk_resp: DkResponse = resp.json().await
            .context("failed to parse DraftKings response")?;

        let Some(event_group) = dk_resp.event_group else {
            return Ok(Vec::new());
        };

        // Build event_id -> DkEvent lookup
        let event_map: std::collections::HashMap<u64, &DkEvent> = event_group.events
            .iter()
            .map(|e| (e.event_id, e))
            .collect();

        let mut updates: Vec<OddsUpdate> = Vec::new();

        // Flatten all offers across categories
        for category in &event_group.offer_categories {
            for offer_list in &category.offers {
                for offer in offer_list {
                    if offer.is_suspended || offer.outcomes.len() < 2 {
                        continue;
                    }

                    let Some(event) = event_map.get(&offer.event_id) else {
                        continue;
                    };

                    // Determine home/away from event team names or outcome labels
                    let (home_team, away_team) = match (&event.team_name1, &event.team_name2) {
                        (Some(t1), Some(t2)) => (t1.clone(), t2.clone()),
                        _ => {
                            // Fall back to outcome labels
                            if offer.outcomes.len() >= 2 {
                                (offer.outcomes[0].label.clone(), offer.outcomes[1].label.clone())
                            } else {
                                continue;
                            }
                        }
                    };

                    let home_odds = offer.outcomes.iter()
                        .find(|o| o.label == home_team)
                        .and_then(|o| parse_american_odds(&o.odds_american));
                    let away_odds = offer.outcomes.iter()
                        .find(|o| o.label == away_team)
                        .and_then(|o| parse_american_odds(&o.odds_american));

                    if let (Some(h), Some(a)) = (home_odds, away_odds) {
                        updates.push(OddsUpdate {
                            event_id: offer.event_id.to_string(),
                            sport: sport.to_string(),
                            home_team: home_team.clone(),
                            away_team: away_team.clone(),
                            commence_time: event.start_date.clone(),
                            bookmakers: vec![BookmakerOdds {
                                name: "DraftKings".to_string(),
                                home_odds: h,
                                away_odds: a,
                                draw_odds: None,
                                last_update: chrono::Utc::now().to_rfc3339(),
                            }],
                        });
                    }
                }
            }
        }

        Ok(updates)
    }

    fn last_quota(&self) -> Option<ApiQuota> {
        None // DraftKings has no API quota concept
    }
}
```

**Step 4: Register the module in `feed/mod.rs`**

Add `pub mod draftkings;` after the existing module declarations:

```rust
pub mod draftkings;
pub mod score_feed;
pub mod the_odds_api;
pub mod types;
```

**Step 5: Run tests to verify they pass**

Run: `cd kalshi-arb && cargo test feed::draftkings::tests -- --nocapture`
Expected: PASS (all 6 tests)

**Step 6: Run full compilation check**

Run: `cd kalshi-arb && cargo check`
Expected: OK

**Step 7: Commit**

```bash
git add kalshi-arb/src/feed/draftkings.rs kalshi-arb/src/feed/mod.rs
git commit -m "feat(feed): implement DraftKingsFeed with OddsFeed trait"
```

---

### Task 4: Add `odds_source` field to `AppState` and update TUI header

**Files:**
- Modify: `kalshi-arb/src/tui/state.rs:27-67` (`AppState` struct)
- Modify: `kalshi-arb/src/tui/render.rs:258-268` (title rendering)

**Step 1: Add `odds_source` field to `AppState`**

In `kalshi-arb/src/tui/state.rs`, add a field to `AppState`:

```rust
pub odds_source: String,
```

And initialize it in `AppState::new()` (find the `impl AppState` block):

```rust
odds_source: "ODDS-API".to_string(),
```

**Step 2: Update the TUI title to include the source indicator**

In `kalshi-arb/src/tui/render.rs`, replace lines 258-262:

```rust
let title = if state.sim_mode {
    format!(" Kalshi Arb Engine [SIMULATION] [{}] ", state.odds_source)
} else {
    format!(" Kalshi Arb Engine [{}] ", state.odds_source)
};
```

And update the `Span::styled` call at line 271 to use `&title` (it's now a `String` not `&str`).

**Step 3: Verify it compiles**

Run: `cd kalshi-arb && cargo check`
Expected: OK

**Step 4: Commit**

```bash
git add kalshi-arb/src/tui/state.rs kalshi-arb/src/tui/render.rs
git commit -m "feat(tui): show active odds source in title bar"
```

---

### Task 5: Wire source strategy into `main.rs`

**Files:**
- Modify: `kalshi-arb/src/main.rs:12` (imports)
- Modify: `kalshi-arb/src/main.rs:882-1057` (initialization and odds feed setup)
- Modify: `kalshi-arb/src/main.rs:1166,1435,1527,1606` (all `fetch_odds` call sites)

This is the largest task. The key changes are:

1. Make odds_api_key optional (only required when source_strategy uses the-odds-api)
2. Construct feed(s) based on source_strategy
3. Replace all `odds_feed.fetch_odds()` calls with dispatch logic
4. Set the `odds_source` field in AppState

**Step 1: Update imports**

At line 12, change:

```rust
use feed::{the_odds_api::TheOddsApi, OddsFeed};
```

to:

```rust
use feed::{the_odds_api::TheOddsApi, draftkings::DraftKingsFeed, OddsFeed};
```

**Step 2: Make odds_api_key conditional**

Replace the unconditional `Config::odds_api_key()?` at line 884. The key should only be required when source_strategy needs The-Odds-API:

```rust
let source_strategy = config.odds_feed.source_strategy.as_str();
let needs_odds_api = matches!(source_strategy, "the-odds-api" | "draftkings+fallback" | "blend");

let odds_api_key = if needs_odds_api {
    Some(Config::odds_api_key()?)
} else {
    // Try env var but don't prompt
    std::env::var("ODDS_API_KEY").ok().filter(|k| !k.is_empty())
};
```

**Step 3: Construct feeds based on source_strategy**

Replace the single `TheOddsApi::new(...)` initialization at line 1023 with:

```rust
let dk_config = config.draftkings_feed.clone().unwrap_or_default();
let mut dk_feed: Option<DraftKingsFeed> = None;
let mut odds_api_feed: Option<TheOddsApi> = None;

match source_strategy {
    "draftkings" => {
        dk_feed = Some(DraftKingsFeed::new(&dk_config));
        println!("  Odds source: DraftKings (direct scrape)");
    }
    "the-odds-api" => {
        let key = odds_api_key.clone().expect("odds API key required for the-odds-api strategy");
        odds_api_feed = Some(TheOddsApi::new(key, &config.odds_feed.base_url, &config.odds_feed.bookmakers));
    }
    "draftkings+fallback" => {
        dk_feed = Some(DraftKingsFeed::new(&dk_config));
        let key = odds_api_key.clone().expect("odds API key required for fallback strategy");
        odds_api_feed = Some(TheOddsApi::new(key, &config.odds_feed.base_url, &config.odds_feed.bookmakers));
        println!("  Odds source: DraftKings + The-Odds-API fallback");
    }
    "blend" => {
        dk_feed = Some(DraftKingsFeed::new(&dk_config));
        let key = odds_api_key.clone().expect("odds API key required for blend strategy");
        odds_api_feed = Some(TheOddsApi::new(key, &config.odds_feed.base_url, &config.odds_feed.bookmakers));
        println!("  Odds source: Blend (DraftKings + The-Odds-API)");
    }
    other => {
        eprintln!("  Unknown source_strategy: {}", other);
        std::process::exit(1);
    }
}
```

**Step 4: Make quota check conditional**

The existing quota check (lines 1026-1043) should only run when `odds_api_feed` is `Some`:

```rust
if let Some(ref mut oaf) = odds_api_feed {
    match oaf.check_quota().await {
        Ok(quota) => {
            println!("  Odds API OK: {}/{} requests remaining",
                quota.requests_remaining,
                quota.requests_used + quota.requests_remaining,
            );
            state_tx.send_modify(|s| {
                s.api_requests_used = quota.requests_used;
                s.api_requests_remaining = quota.requests_remaining;
                s.api_burn_rate = 0.0;
                s.api_hours_remaining = f64::INFINITY;
            });
        }
        Err(e) => {
            eprintln!("  Odds API error: {:#}", e);
            std::process::exit(1);
        }
    }
}
```

**Step 5: Set `odds_source` in AppState**

After feed construction, set the TUI display label:

```rust
let source_label = match source_strategy {
    "draftkings" => "DK",
    "the-odds-api" => "ODDS-API",
    "draftkings+fallback" => "DK+FB",
    "blend" => "BLEND",
    _ => "UNKNOWN",
};
state_tx.send_modify(|s| {
    s.odds_source = source_label.to_string();
});
```

**Step 6: Update poll interval extraction**

The poll intervals should come from the active feed's config. After the existing interval extraction (lines 1051-1056), add DK-specific intervals:

```rust
let dk_live_poll_interval = Duration::from_secs(dk_config.live_poll_interval_s);
let dk_pre_game_poll_interval = Duration::from_secs(dk_config.pre_game_poll_interval_s);
```

**Step 7: Create a fetch dispatch helper**

Add a helper function (or closure) that all 4 `fetch_odds` call sites can use. This avoids duplicating the match logic 4 times.

Before the engine spawn, define:

```rust
/// Fetch odds using the configured source strategy.
async fn fetch_with_strategy(
    strategy: &str,
    sport: &str,
    dk_feed: &mut Option<DraftKingsFeed>,
    odds_api_feed: &mut Option<TheOddsApi>,
) -> Result<Vec<feed::types::OddsUpdate>> {
    match strategy {
        "draftkings" => {
            dk_feed.as_mut().unwrap().fetch_odds(sport).await
        }
        "the-odds-api" => {
            odds_api_feed.as_mut().unwrap().fetch_odds(sport).await
        }
        "draftkings+fallback" => {
            match dk_feed.as_mut().unwrap().fetch_odds(sport).await {
                Ok(updates) => Ok(updates),
                Err(e) => {
                    tracing::warn!("DK fetch failed, falling back to The-Odds-API: {e}");
                    odds_api_feed.as_mut().unwrap().fetch_odds(sport).await
                }
            }
        }
        "blend" => {
            let dk_result = dk_feed.as_mut().unwrap().fetch_odds(sport).await;
            let api_result = odds_api_feed.as_mut().unwrap().fetch_odds(sport).await;
            // Use whichever succeeds; if both succeed, combine them
            match (dk_result, api_result) {
                (Ok(dk), Ok(api)) => {
                    // Merge: DK updates take priority, append API-only games
                    let mut merged = dk;
                    let dk_events: std::collections::HashSet<String> = merged.iter()
                        .map(|u| format!("{}-{}", u.home_team, u.away_team))
                        .collect();
                    for update in api {
                        let key = format!("{}-{}", update.home_team, update.away_team);
                        if dk_events.contains(&key) {
                            // Find matching DK update and append bookmakers
                            if let Some(dk_update) = merged.iter_mut()
                                .find(|u| format!("{}-{}", u.home_team, u.away_team) == key)
                            {
                                dk_update.bookmakers.extend(update.bookmakers);
                            }
                        } else {
                            merged.push(update);
                        }
                    }
                    Ok(merged)
                }
                (Ok(dk), Err(_)) => Ok(dk),
                (Err(_), Ok(api)) => Ok(api),
                (Err(e1), Err(e2)) => {
                    anyhow::bail!("Both feeds failed: DK={e1}, API={e2}")
                }
            }
        }
        _ => anyhow::bail!("unknown source_strategy"),
    }
}
```

Since this is an async function that borrows mutable references, it may be easier to inline as a macro or just use a match block at each call site. The implementer should decide the cleanest approach for the borrow checker — the logic is what matters.

**Step 8: Replace all 4 `fetch_odds` call sites**

Replace each `odds_feed.fetch_odds(sport)` with the dispatch logic. The 4 locations are:

1. `main.rs:1166` - diagnostic mode initial fetch
2. `main.rs:1435` - main poll loop
3. `main.rs:1527` - diagnostic mode poll
4. `main.rs:1606` - diagnostic mode refresh

At each site, replace `odds_feed.fetch_odds(diag_sport)` with the strategy dispatch. Also update quota tracking to be conditional:

```rust
// Only track quota if we got one (not from DK)
if let Some(ref oaf) = odds_api_feed {
    if let Some(quota) = oaf.last_quota() {
        // ... existing quota tracking ...
    }
}
```

**Step 9: Update poll interval selection**

The poll interval should use the DK interval when DK is the active source. At each interval check, use:

```rust
let effective_live_interval = if dk_feed.is_some() && source_strategy != "the-odds-api" {
    dk_live_poll_interval
} else {
    live_poll_interval
};
```

**Step 10: Verify it compiles**

Run: `cd kalshi-arb && cargo check`
Expected: OK

**Step 11: Run all tests**

Run: `cd kalshi-arb && cargo test -- --nocapture`
Expected: All existing tests still pass

**Step 12: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "feat(main): wire source_strategy dispatch for DK/API/fallback/blend"
```

---

### Task 6: Integration test with live DraftKings endpoint

**Files:**
- Modify: `kalshi-arb/src/feed/draftkings.rs` (add integration test)

**Step 1: Add an ignored integration test**

Add to the `tests` module in `draftkings.rs`:

```rust
/// Integration test: hits the real DraftKings API.
/// Run with: cargo test dk_live --ignored -- --nocapture
#[tokio::test]
#[ignore]
async fn dk_live_fetch() {
    let config = crate::config::DraftKingsFeedConfig::default();
    let mut feed = DraftKingsFeed::new(&config);
    match feed.fetch_odds("basketball").await {
        Ok(updates) => {
            println!("Got {} NBA events from DraftKings", updates.len());
            for u in &updates {
                println!("  {} vs {} | bookmakers: {}", u.home_team, u.away_team, u.bookmakers.len());
                for bm in &u.bookmakers {
                    println!("    {}: home={} away={}", bm.name, bm.home_odds, bm.away_odds);
                }
            }
            // During NBA season there should be events; off-season may be 0
            // Just verify it didn't crash
        }
        Err(e) => {
            println!("DK fetch error (may be expected if not in US): {:#}", e);
        }
    }
}
```

**Step 2: Run the integration test manually**

Run: `cd kalshi-arb && cargo test dk_live --ignored -- --nocapture`
Expected: Either events are returned or a network error (if not in US). Should not panic.

**Step 3: Commit**

```bash
git add kalshi-arb/src/feed/draftkings.rs
git commit -m "test(feed): add DraftKings live integration test"
```

---

### Task 7: Test end-to-end with config change

**Step 1: Test with `source_strategy = "draftkings"`**

Edit `config.toml`:
```toml
[odds_feed]
source_strategy = "draftkings"
```

Run: `cd kalshi-arb && cargo run`
Expected: Title bar shows `[DK]`, no odds API key prompt, DK-sourced odds appear for basketball games

**Step 2: Test with `source_strategy = "draftkings+fallback"`**

Edit `config.toml`:
```toml
[odds_feed]
source_strategy = "draftkings+fallback"
```

Run: `cd kalshi-arb && cargo run`
Expected: Title bar shows `[DK+FB]`, odds API key prompted, DK used as primary

**Step 3: Test with `source_strategy = "the-odds-api"` (default)**

Revert `config.toml` to no `source_strategy` field or set it explicitly.

Run: `cd kalshi-arb && cargo run`
Expected: Behavior identical to before this feature was added. Title shows `[ODDS-API]`.

**Step 4: Revert config to desired default and commit**

```bash
git add kalshi-arb/config.toml
git commit -m "test: verify all source strategies work end-to-end"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Config structs + TOML | `config.rs`, `config.toml` |
| 2 | DK response types | `feed/types.rs` |
| 3 | `DraftKingsFeed` implementation | `feed/draftkings.rs`, `feed/mod.rs` |
| 4 | TUI source indicator | `tui/state.rs`, `tui/render.rs` |
| 5 | Main loop wiring | `main.rs` |
| 6 | Integration test | `feed/draftkings.rs` |
| 7 | End-to-end validation | Manual testing |

No new crate dependencies. All existing tests must continue to pass. Backwards compatible with existing config.
