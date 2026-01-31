# College Basketball Score Model Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a college basketball score-based fair value pipeline (ESPN score feed + adapted win probability model) so the engine has speed edge on hundreds of college games per day, not just 5-10 NBA games.

**Architecture:** Generalize WinProbTable to accept `regulation_secs` so the same logistic model works for both NBA (2880s / 96 buckets) and college basketball (2400s / 80 buckets). Add a second ScorePoller instance for ESPN college basketball. Route college score updates through `process_score_updates` with a college-specific WinProbTable and `"college-basketball"` sport key for matcher lookups.

**Tech Stack:** Rust, reqwest, serde, chrono, ratatui (existing stack)

---

### Task 1: Add `regulation_secs` to WinProbTable

**Files:**
- Modify: `src/engine/win_prob.rs`
- Modify: `src/config.rs`
- Modify: `config.toml`

**Step 1: Write the failing test**

Add to `src/engine/win_prob.rs` tests:

```rust
#[test]
fn test_college_regulation_buckets() {
    // College: 2400s regulation, 80 buckets (2400/30)
    let table = WinProbTable::new(3.5, 0.065, 0.25, 0.10, 1.0, 2400);
    // At end of regulation (bucket 80), leading team wins
    let prob = table.lookup(5, 80);
    assert_eq!(prob, 100);
    // Tied at end of regulation
    let prob = table.lookup(0, 80);
    assert_eq!(prob, 57);
}

#[test]
fn test_nba_unchanged_with_regulation_secs() {
    // NBA: 2880s regulation (default), 96 buckets
    let nba = WinProbTable::new(2.5, 0.065, 0.25, 0.10, 1.0, 2880);
    let prob = nba.lookup(0, 0);
    assert!(prob >= 52 && prob <= 57, "got {prob}");
    let prob = nba.lookup(10, 92);
    assert!(prob >= 95, "got {prob}");
    let prob = nba.lookup(5, 96);
    assert_eq!(prob, 100);
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p kalshi-arb test_college_regulation_buckets -- --nocapture`
Expected: FAIL — `WinProbTable::new` takes 5 args, not 6

**Step 3: Implement regulation_secs in WinProbTable**

In `src/engine/win_prob.rs`:

1. Add `regulation_secs: u16` field to `WinProbTable` struct.
2. Update `new()` to accept `regulation_secs: u16` parameter.
3. Compute `regulation_buckets` as `(regulation_secs as f64 / 30.0)` inside `lookup()`.
4. Replace hardcoded `96.0` with `regulation_buckets` in both the end-of-regulation check and the k-ramp formula.
5. Update `fair_value()` — it currently calls `lookup()` which already uses bucket internally.
6. Update `from_config()`.

In `src/config.rs`:

1. Add `regulation_secs: Option<u16>` to `WinProbConfig` with `#[serde(default)]`.
2. Update `WinProbConfig::default()` to set `regulation_secs` to `2880` (NBA).

In `src/engine/win_prob.rs`:

1. Update `from_config()` to pass `regulation_secs.unwrap_or(2880)`.
2. Update `default_table()` in tests to pass `2880`.

**Step 4: Run tests to verify they pass**

Run: `cargo test -p kalshi-arb -- --nocapture`
Expected: All existing tests pass (NBA behavior unchanged), two new tests pass.

**Step 5: Commit**

```bash
git add src/engine/win_prob.rs src/config.rs
git commit -m "feat(win_prob): add regulation_secs parameter to WinProbTable"
```

---

### Task 2: Add `compute_elapsed_college()` to score_feed.rs

**Files:**
- Modify: `src/feed/score_feed.rs`

**Step 1: Write the failing tests**

Add to `src/feed/score_feed.rs` tests:

```rust
#[test]
fn test_college_elapsed_game_start() {
    // Period 1, 20:00 on clock = 0 elapsed
    assert_eq!(ScoreUpdate::compute_elapsed_college(1, 1200), 0);
}

#[test]
fn test_college_elapsed_end_first_half() {
    // Period 1, 0:00 on clock = 1200s elapsed
    assert_eq!(ScoreUpdate::compute_elapsed_college(1, 0), 1200);
}

#[test]
fn test_college_elapsed_start_second_half() {
    // Period 2, 20:00 on clock = 1200s elapsed
    assert_eq!(ScoreUpdate::compute_elapsed_college(2, 1200), 1200);
}

#[test]
fn test_college_elapsed_end_regulation() {
    // Period 2, 0:00 on clock = 2400s elapsed
    assert_eq!(ScoreUpdate::compute_elapsed_college(2, 0), 2400);
}

#[test]
fn test_college_elapsed_overtime_start() {
    // Period 3 (OT1), 5:00 on clock = 2400s elapsed
    assert_eq!(ScoreUpdate::compute_elapsed_college(3, 300), 2400);
}

#[test]
fn test_college_elapsed_overtime_end() {
    // Period 3 (OT1), 0:00 on clock = 2700s elapsed
    assert_eq!(ScoreUpdate::compute_elapsed_college(3, 0), 2700);
}
```

**Step 2: Run tests to verify they fail**

Run: `cargo test -p kalshi-arb test_college_elapsed -- --nocapture`
Expected: FAIL — `compute_elapsed_college` doesn't exist

**Step 3: Implement compute_elapsed_college**

Add to `impl ScoreUpdate` in `src/feed/score_feed.rs`:

```rust
/// Compute total elapsed seconds for college basketball.
/// College: 2 halves x 20 min (1200s each). OT periods are 5 min (300s each).
pub fn compute_elapsed_college(period: u8, clock_seconds: u16) -> u16 {
    if period == 0 {
        return 0;
    }
    if period <= 2 {
        let completed = (period - 1) as u16;
        completed * 1200 + (1200 - clock_seconds)
    } else {
        // Overtime: regulation (2400s) + completed OT periods
        let ot_period = (period - 3) as u16;
        2400 + ot_period * 300 + (300 - clock_seconds)
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `cargo test -p kalshi-arb -- --nocapture`
Expected: All tests pass including 6 new college elapsed tests.

**Step 5: Commit**

```bash
git add src/feed/score_feed.rs
git commit -m "feat(score_feed): add compute_elapsed_college for 2x20min halves"
```

---

### Task 3: Add college basketball ESPN score feed config and ScorePoller

**Files:**
- Modify: `src/config.rs`
- Modify: `config.toml`

**Step 1: Add college score feed config section**

In `src/config.rs`, add:

```rust
#[derive(Debug, Deserialize, Clone)]
pub struct CollegeScoreFeedConfig {
    pub espn_mens_url: String,
    pub espn_womens_url: String,
    pub live_poll_interval_s: u64,
    pub pre_game_poll_interval_s: u64,
    pub request_timeout_ms: u64,
}
```

Add to `Config` struct:

```rust
pub college_score_feed: Option<CollegeScoreFeedConfig>,
```

In `config.toml`, add:

```toml
[college_score_feed]
espn_mens_url = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard"
espn_womens_url = "https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard"
live_poll_interval_s = 1
pre_game_poll_interval_s = 60
request_timeout_ms = 1000
```

**Step 2: Run test to verify config parses**

Run: `cargo test -p kalshi-arb test_config_parses -- --nocapture`
Expected: PASS — new optional section parses.

**Step 3: Commit**

```bash
git add src/config.rs config.toml
git commit -m "feat(config): add college_score_feed config section"
```

---

### Task 4: Add college WinProbConfig defaults

**Files:**
- Modify: `src/config.rs`
- Modify: `config.toml`

**Step 1: Add college_win_prob config section**

In `src/config.rs`, add to `Config`:

```rust
pub college_win_prob: Option<WinProbConfig>,
```

In `config.toml`, add:

```toml
[college_win_prob]
home_advantage = 3.5
k_start = 0.065
k_range = 0.25
ot_k_start = 0.10
ot_k_range = 1.0
regulation_secs = 2400
```

Note: `regulation_secs = 2400` (college: 2 x 20min = 2400s) vs NBA default of 2880.

**Step 2: Write a test for college WinProbTable construction**

Add to `src/engine/win_prob.rs` tests:

```rust
#[test]
fn test_college_table_from_defaults() {
    // College: higher home advantage (3.5), 2400s regulation
    let table = WinProbTable::new(3.5, 0.065, 0.25, 0.10, 1.0, 2400);
    // Pregame: home advantage of 3.5 should give ~58-62%
    let prob = table.lookup(0, 0);
    assert!(prob >= 56 && prob <= 62, "got {prob}");
    // End of regulation tie -> OT edge
    let prob = table.lookup(0, 80);
    assert_eq!(prob, 57);
}
```

**Step 3: Run tests**

Run: `cargo test -p kalshi-arb -- --nocapture`
Expected: All pass.

**Step 4: Commit**

```bash
git add src/config.rs config.toml src/engine/win_prob.rs
git commit -m "feat(config): add college_win_prob config with 2400s regulation"
```

---

### Task 5: Create college ScorePoller in score_feed.rs

**Files:**
- Modify: `src/feed/score_feed.rs`

ESPN uses the same JSON format for college basketball as NBA (the `EspnScoreboard` → `EspnEvent` → `EspnCompetition` structure). The existing `parse_espn_scoreboard()` function already works for college basketball. We need a simplified poller that only uses ESPN (no NBA CDN endpoint for college).

**Step 1: Add CollegeScorePoller struct**

```rust
pub struct CollegeScorePoller {
    client: Client,
    mens_url: String,
    womens_url: String,
    timeout: Duration,
    last_etag: HashMap<String, String>,
    cached_response: HashMap<String, Vec<ScoreUpdate>>,
}

impl CollegeScorePoller {
    pub fn new(mens_url: &str, womens_url: &str, timeout_ms: u64) -> Self {
        Self {
            client: Client::new(),
            mens_url: mens_url.to_string(),
            womens_url: womens_url.to_string(),
            timeout: Duration::from_millis(timeout_ms),
            last_etag: HashMap::new(),
            cached_response: HashMap::new(),
        }
    }

    /// Fetch both men's and women's college basketball scores.
    /// Returns (mens_updates, womens_updates).
    pub async fn fetch(&mut self) -> anyhow::Result<(Vec<ScoreUpdate>, Vec<ScoreUpdate>)> {
        let mens = self.fetch_endpoint(&self.mens_url.clone()).await.unwrap_or_default();
        let womens = self.fetch_endpoint(&self.womens_url.clone()).await.unwrap_or_default();
        Ok((mens, womens))
    }

    async fn fetch_endpoint(&mut self, url: &str) -> anyhow::Result<Vec<ScoreUpdate>> {
        let mut req = self.client.get(url).timeout(self.timeout);
        if let Some(etag) = self.last_etag.get(url) {
            req = req.header("If-None-Match", etag.as_str());
        }
        let resp = req.send().await?;

        if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
            if let Some(cached) = self.cached_response.get(url) {
                return Ok(cached.clone());
            }
        }

        if let Some(etag) = resp.headers().get("etag") {
            if let Ok(etag_str) = etag.to_str() {
                self.last_etag.insert(url.to_string(), etag_str.to_string());
            }
        }

        let text = resp.text().await?;
        let mut updates = parse_espn_scoreboard(&text)?;
        // Recompute elapsed with college period structure
        for u in &mut updates {
            u.total_elapsed_seconds = ScoreUpdate::compute_elapsed_college(u.period, u.clock_seconds);
        }
        self.cached_response.insert(url.to_string(), updates.clone());
        Ok(updates)
    }
}
```

**Step 2: Run tests**

Run: `cargo test -p kalshi-arb -- --nocapture`
Expected: All pass (no new tests needed — using existing parse_espn_scoreboard).

**Step 3: Commit**

```bash
git add src/feed/score_feed.rs
git commit -m "feat(score_feed): add CollegeScorePoller with men's and women's ESPN endpoints"
```

---

### Task 6: Add `process_college_score_updates()` to main.rs

**Files:**
- Modify: `src/main.rs`

This is similar to `process_score_updates()` but uses `"college-basketball"` (or `"college-basketball-womens"`) for matcher lookups and the college WinProbTable.

**Step 1: Add function**

```rust
/// Process score feed updates for college basketball games.
/// Uses college WinProbTable (2400s regulation, 3.5 home advantage).
#[allow(clippy::too_many_arguments)]
fn process_college_score_updates(
    updates: &[feed::score_feed::ScoreUpdate],
    sport: &str, // "college-basketball" or "college-basketball-womens"
    market_index: &matcher::MarketIndex,
    live_book_engine: &LiveBook,
    strategy_config: &config::StrategyConfig,
    momentum_config: &config::MomentumConfig,
    velocity_trackers: &mut HashMap<String, VelocityTracker>,
    book_pressure_trackers: &mut HashMap<String, BookPressureTracker>,
    scorer: &MomentumScorer,
    sim_mode: bool,
    state_tx: &watch::Sender<AppState>,
    cycle_start: Instant,
    last_score_fetch: &HashMap<String, Instant>,
    sim_config: &config::SimulationConfig,
    win_prob_table: &engine::win_prob::WinProbTable,
) -> SportProcessResult {
    // Same structure as process_score_updates but uses:
    // - sport parameter for matcher::find_match (not hardcoded "basketball")
    // - College WinProbTable (already handles 2400s regulation via regulation_secs)
    // - OT detection: period > 2 (not period > 4)

    let mut filter_live: usize = 0;
    let mut filter_pre_game: usize = 0;
    let mut filter_closed: usize = 0;
    let earliest_commence: Option<chrono::DateTime<chrono::Utc>> = None;
    let mut rows: HashMap<String, MarketRow> = HashMap::new();

    let now_utc = chrono::Utc::now();

    for update in updates {
        match update.game_status {
            feed::score_feed::GameStatus::PreGame => {
                filter_pre_game += 1;
                continue;
            }
            feed::score_feed::GameStatus::Finished => {
                filter_closed += 1;
                continue;
            }
            _ => {}
        }

        let staleness_secs = last_score_fetch.get(&update.game_id)
            .map(|t| cycle_start.duration_since(*t).as_secs());
        let is_stale = staleness_secs.is_some_and(|s| s > 10);

        let score_diff = update.home_score as i32 - update.away_score as i32;
        let (home_fair, _away_fair) = if update.period > 2 {
            // College OT: periods 3+ are overtime
            let ot_elapsed = update.total_elapsed_seconds.saturating_sub(2400);
            win_prob_table.fair_value_overtime(score_diff, ot_elapsed)
        } else {
            win_prob_table.fair_value(score_diff, update.total_elapsed_seconds)
        };

        let vt = velocity_trackers
            .entry(update.game_id.clone())
            .or_insert_with(|| VelocityTracker::new(momentum_config.velocity_window_size));
        vt.push(home_fair as f64 / 100.0, Instant::now());
        let velocity_score = vt.score();

        let eastern = chrono::FixedOffset::west_opt(5 * 3600).unwrap();
        let today = chrono::Utc::now().with_timezone(&eastern).date_naive();

        if let Some(mkt) = matcher::find_match(
            market_index,
            sport,
            &update.home_team,
            &update.away_team,
            today,
        ) {
            let fair = home_fair;

            let key_check = matcher::generate_key(sport, &update.home_team, &update.away_team, today);
            let game_check = key_check.and_then(|k| market_index.get(&k));
            let side_market = game_check.and_then(|g| {
                if mkt.is_inverse { g.away.as_ref() } else { g.home.as_ref() }
            });

            match evaluate_matched_market(
                &mkt.ticker, fair, mkt.best_bid, mkt.best_ask, mkt.is_inverse,
                velocity_score, staleness_secs, is_stale, side_market, now_utc,
                live_book_engine, strategy_config, momentum_config,
                book_pressure_trackers, scorer, sim_mode, state_tx, cycle_start,
                "score_feed", sim_config,
            ) {
                EvalOutcome::Closed => { filter_closed += 1; }
                EvalOutcome::Evaluated(row) => {
                    filter_live += 1;
                    rows.insert(mkt.ticker.clone(), row);
                }
            }
        }
    }

    SportProcessResult { filter_live, filter_pre_game, filter_closed, earliest_commence, rows }
}
```

**Step 2: Run `cargo check`**

Run: `cargo check -p kalshi-arb`
Expected: Compiles (function defined but not yet called).

**Step 3: Commit**

```bash
git add src/main.rs
git commit -m "feat: add process_college_score_updates function"
```

---

### Task 7: Wire college score feed into engine loop

**Files:**
- Modify: `src/main.rs`

**Step 1: Initialize college poller and win prob table**

After the existing `score_poller` initialization (line ~897), add:

```rust
let mut college_score_poller = config.college_score_feed.as_ref().map(|csf| {
    feed::score_feed::CollegeScorePoller::new(
        &csf.espn_mens_url,
        &csf.espn_womens_url,
        csf.request_timeout_ms,
    )
});
let college_score_live_interval = config.college_score_feed.as_ref()
    .map(|csf| Duration::from_secs(csf.live_poll_interval_s))
    .unwrap_or(Duration::from_secs(3));
let college_score_pre_game_interval = config.college_score_feed.as_ref()
    .map(|csf| Duration::from_secs(csf.pre_game_poll_interval_s))
    .unwrap_or(Duration::from_secs(60));

let college_win_prob_config = config.college_win_prob.clone().unwrap_or(config::WinProbConfig {
    home_advantage: 3.5,
    k_start: 0.065,
    k_range: 0.25,
    ot_k_start: 0.10,
    ot_k_range: 1.0,
    regulation_secs: Some(2400),
});
let college_win_prob_table = engine::win_prob::WinProbTable::from_config(&college_win_prob_config);
```

**Step 2: Add college score polling to engine loop**

Inside the engine loop, after the NBA score feed block (after `if let Some(ref mut poller) = score_poller { ... }`), add a similar block for college:

```rust
// --- College score feed (if configured) ---
if let Some(ref mut college_poller) = college_score_poller {
    let college_interval = if college_mens_cached.iter().any(|u| u.game_status == feed::score_feed::GameStatus::Live)
        || college_womens_cached.iter().any(|u| u.game_status == feed::score_feed::GameStatus::Live)
    {
        college_score_live_interval
    } else {
        college_score_pre_game_interval
    };

    let should_fetch_college = match last_college_score_poll {
        Some(last) => cycle_start.duration_since(last) >= college_interval,
        None => true,
    };

    if should_fetch_college {
        match college_poller.fetch().await {
            Ok((mens, womens)) => {
                last_college_score_poll = Some(Instant::now());
                for u in &mens {
                    college_last_score_fetch.insert(u.game_id.clone(), Instant::now());
                }
                for u in &womens {
                    college_last_score_fetch.insert(u.game_id.clone(), Instant::now());
                }
                college_mens_cached = mens;
                college_womens_cached = womens;
            }
            Err(e) => {
                tracing::warn!(error = %e, "college score feed fetch failed");
            }
        }
    }

    // Process men's college scores
    if !college_mens_cached.is_empty() {
        let result = process_college_score_updates(
            &college_mens_cached,
            "college-basketball",
            &market_index, &live_book_engine, &strategy_config, &momentum_config,
            &mut velocity_trackers, &mut book_pressure_trackers, &scorer,
            sim_mode_engine, &state_tx_engine, cycle_start,
            &college_last_score_fetch, &sim_config, &college_win_prob_table,
        );
        filter_live += result.filter_live;
        filter_pre_game += result.filter_pre_game;
        filter_closed += result.filter_closed;
        accumulated_rows.extend(result.rows);
    }

    // Process women's college scores
    if !college_womens_cached.is_empty() {
        let result = process_college_score_updates(
            &college_womens_cached,
            "college-basketball-womens",
            &market_index, &live_book_engine, &strategy_config, &momentum_config,
            &mut velocity_trackers, &mut book_pressure_trackers, &scorer,
            sim_mode_engine, &state_tx_engine, cycle_start,
            &college_last_score_fetch, &sim_config, &college_win_prob_table,
        );
        filter_live += result.filter_live;
        filter_pre_game += result.filter_pre_game;
        filter_closed += result.filter_closed;
        accumulated_rows.extend(result.rows);
    }
}
```

Also add the state variables near the existing score feed state vars:

```rust
let mut last_college_score_poll: Option<Instant> = None;
let mut college_last_score_fetch: HashMap<String, Instant> = HashMap::new();
let mut college_mens_cached: Vec<feed::score_feed::ScoreUpdate> = Vec::new();
let mut college_womens_cached: Vec<feed::score_feed::ScoreUpdate> = Vec::new();
```

**Step 3: Filter college basketball from odds_sports if score feed is active**

Update the `odds_sports` filter (line ~880) to also exclude college-basketball when the college score feed is configured:

```rust
let odds_sports: Vec<String> = config.odds_feed.sports.iter()
    .filter(|s| !(config.score_feed.is_some() && s.as_str() == "basketball"))
    .filter(|s| !(config.college_score_feed.is_some() && (s.as_str() == "college-basketball" || s.as_str() == "college-basketball-womens")))
    .cloned()
    .collect();
```

**Step 4: Add college basketball to live_sports display**

In the live_sports section after score feed check, add:

```rust
if college_score_poller.is_some() {
    if college_mens_cached.iter().any(|u| u.game_status == feed::score_feed::GameStatus::Live)
        && !live_sports.contains(&"college-basketball".to_string())
    {
        live_sports.push("college-basketball".to_string());
    }
    if college_womens_cached.iter().any(|u| u.game_status == feed::score_feed::GameStatus::Live)
        && !live_sports.contains(&"college-basketball-womens".to_string())
    {
        live_sports.push("college-basketball-womens".to_string());
    }
}
```

**Step 5: Run `cargo check` and `cargo test`**

Run: `cargo check -p kalshi-arb && cargo test -p kalshi-arb -- --nocapture`
Expected: Compiles and all tests pass.

**Step 6: Commit**

```bash
git add src/main.rs
git commit -m "feat: wire college basketball score feed into engine loop"
```

---

### Task 8: Add integration test for college basketball pipeline

**Files:**
- Modify: `src/engine/win_prob.rs` (add calibration tests)

**Step 1: Add college-specific calibration tests**

```rust
// ---- College basketball calibration ----

#[test]
fn test_college_home_up_5_halftime() {
    let table = WinProbTable::new(3.5, 0.065, 0.25, 0.10, 1.0, 2400);
    // Bucket 40 = halftime (1200s / 30)
    let prob = table.lookup(5, 40);
    assert!(prob >= 66 && prob <= 74, "got {prob}");
}

#[test]
fn test_college_home_up_10_late() {
    let table = WinProbTable::new(3.5, 0.065, 0.25, 0.10, 1.0, 2400);
    // Bucket 76 = ~2 min left (2280s / 30)
    let prob = table.lookup(10, 76);
    assert!(prob >= 95, "got {prob}");
}

#[test]
fn test_college_pregame_home_advantage() {
    let table = WinProbTable::new(3.5, 0.065, 0.25, 0.10, 1.0, 2400);
    let prob = table.lookup(0, 0);
    // 3.5 pt home advantage → ~58-62% pregame
    assert!(prob >= 56 && prob <= 62, "got {prob}");
}

#[test]
fn test_college_fair_value_bridge() {
    let table = WinProbTable::new(3.5, 0.065, 0.25, 0.10, 1.0, 2400);
    // 1800s elapsed = bucket 60 (3/4 through regulation)
    let (home, away) = table.fair_value(8, 1800);
    assert!(home > 70, "got {home}");
    assert_eq!(home + away, 100);
}
```

**Step 2: Run all tests**

Run: `cargo test -p kalshi-arb -- --nocapture`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/engine/win_prob.rs
git commit -m "test(win_prob): add college basketball calibration tests"
```

---

## Summary

| Task | Description | Key files |
|------|-------------|-----------|
| 1 | Add `regulation_secs` to WinProbTable | win_prob.rs, config.rs |
| 2 | Add `compute_elapsed_college()` | score_feed.rs |
| 3 | Add `[college_score_feed]` config | config.rs, config.toml |
| 4 | Add `[college_win_prob]` config | config.rs, config.toml, win_prob.rs |
| 5 | Add `CollegeScorePoller` | score_feed.rs |
| 6 | Add `process_college_score_updates()` | main.rs |
| 7 | Wire into engine loop | main.rs |
| 8 | Add calibration tests | win_prob.rs |

**Total new/modified lines:** ~300-400
**New tests:** ~15
**Risk:** Low — college pipeline is additive, doesn't modify NBA path
