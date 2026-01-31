# DraftKings Live Feed for Fair Value

## Problem

The-Odds-API has two limitations for live basketball arbitrage:
1. **Latency** - Polling at 20s intervals means stale odds during fast-moving NBA games
2. **Cost** - Every API call burns quota; aggressive polling drains it quickly

## Solution

Add a DraftKings scraper that hits their public JSON API (the same endpoints their frontend uses) to get live moneyline odds with ~3s polling and zero API cost.

## Architecture

### New Module: `src/feed/draftkings.rs`

`DraftKingsFeed` implements the existing `OddsFeed` trait, producing the same `OddsUpdate` / `BookmakerOdds` structs with American odds. The entire downstream pipeline (devig, strategy evaluation, Kelly sizing, momentum gating) stays untouched.

### DraftKings API

**Endpoint:**
```
GET https://sportsbook-nash.draftkings.com/sites/US-SB/api/v5/eventgroups/{group_id}/categories/{category_id}/subcategories/{subcategory_id}
```

NBA IDs:
- Event group: `42648`
- Category: `487` (Game Lines)
- Subcategory: `4518` (Moneyline)

**Response (simplified):**
```json
{
  "eventGroup": {
    "events": [
      {
        "eventId": 12345,
        "name": "LAL @ BOS",
        "startDate": "2026-01-31T00:00:00Z",
        "teamName1": "Los Angeles Lakers",
        "teamName2": "Boston Celtics"
      }
    ],
    "offerCategories": [
      {
        "offers": [[{
          "outcomes": [
            { "label": "Los Angeles Lakers", "oddsAmerican": "+150" },
            { "label": "Boston Celtics", "oddsAmerican": "-180" }
          ]
        }]]
      }
    ]
  }
}
```

No authentication required. Public endpoints.

### `DraftKingsFeed` Struct

```rust
pub struct DraftKingsFeed {
    client: reqwest::Client,
    poll_interval: Duration,       // default 3s
    last_fetch: Option<Instant>,
    last_etag: Option<String>,     // conditional GET
}

#[async_trait]
impl OddsFeed for DraftKingsFeed {
    async fn fetch_odds(&mut self, sport: &str) -> Result<Vec<OddsUpdate>>;
    fn last_quota(&self) -> Option<ApiQuota> { None }
}
```

**Sport mapping (basketball only for now):**
```rust
fn dk_event_group(sport: &str) -> Option<u64> {
    match sport {
        "basketball" => Some(42648),
        _ => None,
    }
}
```

**Resilience:**
- ETag-based conditional GET to reduce bandwidth
- User-Agent header (standard browser)
- Graceful 429 handling with backoff + warning log
- Connection reuse via persistent `reqwest::Client`

### Source Strategy (Config-Driven)

Users select their source strategy in config:

```toml
[odds_feed]
source_strategy = "draftkings"    # default: "the-odds-api"

[draftkings_feed]
live_poll_interval_s = 3
pre_game_poll_interval_s = 30
request_timeout_ms = 5000
```

| Strategy | Behavior |
|---|---|
| `"the-odds-api"` | Current behavior. Default if field omitted. |
| `"draftkings"` | DraftKings only. Zero API quota burn. |
| `"draftkings+fallback"` | DraftKings primary, The-Odds-API on failure. |
| `"blend"` | Both sources, average devigged probabilities. Burns quota. |

### Main Loop Wiring

**Initialization:** Construct feed(s) based on `source_strategy`.

**Poll loop dispatch:**
```rust
let odds_updates = match source_strategy {
    "draftkings"          => dk_feed.fetch_odds(sport).await?,
    "the-odds-api"        => odds_api_feed.fetch_odds(sport).await?,
    "draftkings+fallback" => dk_feed with fallback to odds_api_feed,
    "blend"               => fetch both, merge by MarketKey, average probs,
};
// Rest of pipeline unchanged
```

### Team Matching

DraftKings uses standard full names ("Los Angeles Lakers") which the existing `matcher.rs` NBA lookup table already normalizes. Minimal or no changes expected; add any missing variants if discovered during testing.

### TUI

Add a small source indicator label showing `[DK]`, `[ODDS-API]`, `[DK+FB]`, or `[BLEND]` so the active feed is visible at a glance.

## Files Changed

| File | Change |
|---|---|
| `src/feed/draftkings.rs` | New - DraftKings API client implementing `OddsFeed` |
| `src/feed/mod.rs` | Add `pub mod draftkings;` |
| `src/config.rs` | Add `source_strategy` field, `DraftKingsFeedConfig` struct |
| `src/main.rs` | Wire source selection, dispatch in poll loop |
| `src/engine/matcher.rs` | Add DK team name variants if needed |
| `src/tui/` | Source indicator label |

## Out of Scope

- Spreads, totals, or player props (moneyline only)
- Sports other than basketball
- Weighted blending (equal weight only for now)
- WebSocket streaming from DK (polling is sufficient at 3s)

## Risks

- **DraftKings endpoint changes** - These are undocumented internal APIs. IDs or response format could change without notice. Mitigation: clear error messages, fallback strategy.
- **Rate limiting** - Aggressive polling could trigger blocks. Mitigation: configurable interval, ETag caching, backoff on 429.
- **Regional availability** - DK endpoints may vary by region or require US IP. Mitigation: document this as a known constraint.
