# Scraped Odds Feed Design

## Summary

Add a third NCAAB data source: live sportsbook odds scraped from the internet via headless Chromium. Implements the existing `OddsFeed` trait as a standalone source registered as type `"scraped"` in config.

**Target site:** Bovada (`bovada.lv/sports/basketball/college-basketball`) — structured DOM with class-based selectors, well-established scraping target.

**Approach:** Headless browser via the `headless_chrome` Rust crate. Most resilient to JS-heavy page rendering.

## Architecture

### Component Layout

```
src/feed/
├── mod.rs              (add "pub mod scraped;")
├── scraped.rs          (NEW - ScrapedOddsFeed + OddsFeed impl)
├── the_odds_api.rs     (existing, unchanged)
├── draftkings.rs       (existing, unchanged)
└── types.rs            (existing OddsUpdate, unchanged)
```

### Integration

`ScrapedOddsFeed` implements the existing `OddsFeed` trait:

```rust
#[async_trait]
pub trait OddsFeed: Send + Sync {
    async fn fetch_odds(&mut self, sport: &str) -> Result<Vec<OddsUpdate>>;
    fn last_quota(&self) -> Option<ApiQuota>;
}
```

Outputs standard `Vec<OddsUpdate>` with `BookmakerOdds { name: "bovada-scraped", ... }`. The entire downstream pipeline (devigging, matching, strategy evaluation, Kelly sizing, momentum gating) works unchanged.

## Browser Lifecycle

- A single `headless_chrome::Browser` instance created at `ScrapedOddsFeed::new()`.
- Browser wrapped in `Arc` for sharing into `spawn_blocking` closures.
- One tab reused across fetches (navigate rather than open/close).
- Headless mode with `--no-sandbox`, `--disable-gpu`, randomized user-agent.
- If tab crashes: drop and create new tab on next fetch.
- If browser process crashes: respawn `Browser` on next fetch.
- On `Drop`: browser process killed automatically by `headless_chrome`.

## Async Bridge

`headless_chrome` is synchronous. Bridge to tokio via `spawn_blocking`:

```rust
async fn fetch_odds(&mut self, sport: &str) -> Result<Vec<OddsUpdate>> {
    let browser = self.browser.clone();
    let url = self.target_url.clone();
    let timeout = self.timeout;

    tokio::task::spawn_blocking(move || {
        extract_odds_from_page(&browser, &url, timeout)
    }).await?
}
```

## DOM Extraction

1. Navigate to NCAAB scoreboard page.
2. Wait for game container elements to render (configurable timeout, default 10s).
3. For each game card, extract:
   - Team names (home/away)
   - American odds (moneyline): `"-150"`, `"+130"`, `"EVEN"`
   - Game start time / live status
4. Parse odds strings into `f64` values.
5. Build `OddsUpdate` with single `BookmakerOdds` entry per game.

Extraction logic is split into a pure function `extract_odds_from_html(html: &str)` for unit-testability, separate from browser interaction.

## Configuration

### TOML

```toml
[odds_sources.scraped-bovada]
type = "scraped"
base_url = "https://www.bovada.lv/sports/basketball/college-basketball"
live_poll_s = 5
pre_game_poll_s = 60
request_timeout_ms = 10000
max_retries = 2

[sports.college-basketball]
odds_source = "scraped-bovada"
```

### Config Changes

- Add optional `max_retries` field to `OddsSourceConfig` (default: 2).
- New arm `"scraped"` in the odds source registration match in `main.rs`.

### Registration (main.rs)

```rust
"scraped" => {
    let target_url = source_config.base_url.as_deref()
        .unwrap_or("https://www.bovada.lv/sports/basketball/college-basketball");
    let timeout_ms = source_config.request_timeout_ms;
    let max_retries = source_config.max_retries.unwrap_or(2);
    odds_sources.insert(
        name.clone(),
        Box::new(ScrapedOddsFeed::new(target_url, timeout_ms, max_retries)),
    );
}
```

## Polling Intervals

| Context | Interval | Rationale |
|---------|----------|-----------|
| Live games | 5s | Slower than DK API (3s) to reduce detection risk, faster than Odds API (20s) |
| Pre-game | 60s | Standard pre-game cadence |

Configurable via `live_poll_s` / `pre_game_poll_s` in `OddsSourceConfig`.

## Error Handling

| Scenario | Response |
|----------|----------|
| Chromium not found at startup | Log error, exit with message: "scraped source requires Chromium" |
| Page load timeout (>10s) | Retry up to `max_retries`, return cached data if available, `Err` if not |
| No odds elements found in DOM | Log warning, return cached data (likely page structure changed) |
| Odds parse failure | Skip that game, log warning, continue with others |
| Browser tab crash | Drop tab, create new on next fetch |
| Browser process crash | Respawn `Browser` on next fetch |
| Rate limiting / CAPTCHA | Log error, back off to `pre_game_poll_s`, return cached |

`last_quota()` returns `None` (no API quota concept for scraping).

## Resilience

- Cached last-good result returned when fetches fail (same pattern as `ScorePoller` ETag caching).
- Stale data detection: if extracted odds identical to last N fetches, log warning.
- Configurable `max_retries` per fetch cycle (default 2).

## Dependencies

### Cargo.toml

```toml
[dependencies]
headless_chrome = "1"
```

### Runtime

Chromium must be installed on the host system. `headless_chrome` can optionally fetch it on first run.

**Windows note:** Cross-compiles fine, but the `.exe` needs Chrome/Chromium at runtime.

## Testing

- **Unit tests:** Saved HTML fixtures in `tests/fixtures/bovada_ncaab.html`. Test `extract_odds_from_html()` pure function.
- **Integration tests:** `#[ignore]` gated, run manually with live browser.
- **Trait compliance:** Once `ScrapedOddsFeed` outputs valid `Vec<OddsUpdate>`, all downstream pipeline tests apply unchanged.

## File Changes

| File | Change |
|------|--------|
| `src/feed/scraped.rs` | **NEW** — `ScrapedOddsFeed` struct + `OddsFeed` impl |
| `src/feed/mod.rs` | Add `pub mod scraped;` |
| `src/main.rs` | Add `"scraped"` arm in odds source registration |
| `src/config.rs` | Add `max_retries` optional field to `OddsSourceConfig` |
| `Cargo.toml` | Add `headless_chrome = "1"` |
| `tests/fixtures/bovada_ncaab.html` | **NEW** — saved HTML for unit tests |

## Latency Impact

Adding to the latency budget from `NCAAB_DATA_FLOW_ANALYSIS.md`:

| Step | Typical | Worst Case |
|------|---------|------------|
| Bovada page load + render | 2-5s | 10s (timeout) |
| DOM extraction + parse | <10ms | <50ms |
| Polling interval (live) | 0-5s | 5s |
| **Total source latency** | **2-10s** | **15s** |

Sits between the score-feed path (~1-7s) and the odds-API path (~5-52s).
