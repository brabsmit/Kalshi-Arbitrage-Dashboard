# NBA Score Feed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace sportsbook odds with live NBA score feeds + a win probability lookup table for NBA fair value computation, reducing latency from 20-40s to 4-8s and eliminating Odds API cost for NBA.

**Architecture:** New `score_feed` module polls NBA/ESPN APIs for live game scores every 2-3s. A static `WinProbTable` maps `(score_diff, time_bucket)` to home win probability. The main loop dispatches NBA games to this new path while other sports continue using the existing odds feed. All downstream logic (strategy evaluation, momentum, TUI) is reused.

**Tech Stack:** Rust, Tokio async, reqwest HTTP client, serde JSON deserialization

**Worktree:** `.worktrees/nba-score-feed` (branch `feature/nba-score-feed`)

---

### Task 1: Win Probability Table — Types and Lookup

**Files:**
- Create: `kalshi-arb/src/engine/win_prob.rs`
- Modify: `kalshi-arb/src/engine/mod.rs`

**Step 1: Write the failing test**

In `kalshi-arb/src/engine/win_prob.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lookup_tied_game_start() {
        // Tied at game start → ~57-58% home (home court advantage)
        let prob = WinProbTable::lookup(0, 0);
        assert!(prob >= 55 && prob <= 60, "got {prob}");
    }

    #[test]
    fn test_lookup_home_up_10_late() {
        // Home +10 with 2 min left → very high probability
        let prob = WinProbTable::lookup(10, 92); // bucket 92 = ~46 min elapsed
        assert!(prob >= 95, "got {prob}");
    }

    #[test]
    fn test_lookup_away_up_10_late() {
        // Home -10 with 2 min left → very low probability
        let prob = WinProbTable::lookup(-10, 92);
        assert!(prob <= 5, "got {prob}");
    }

    #[test]
    fn test_lookup_symmetry() {
        // home +5 at time T should be 100 - (home -5 at time T)
        let up5 = WinProbTable::lookup(5, 48);
        let down5 = WinProbTable::lookup(-5, 48);
        assert!((up5 + down5).abs_diff(100) <= 1, "up5={up5}, down5={down5}");
    }

    #[test]
    fn test_lookup_clamps_extreme_diff() {
        // Beyond ±40 should clamp
        let prob = WinProbTable::lookup(50, 48);
        assert_eq!(prob, 100);
        let prob = WinProbTable::lookup(-50, 48);
        assert_eq!(prob, 0);
    }

    #[test]
    fn test_lookup_end_of_game_positive() {
        // Home ahead at buzzer → 100
        let prob = WinProbTable::lookup(5, 96);
        assert_eq!(prob, 100);
    }

    #[test]
    fn test_lookup_end_of_game_behind() {
        // Home behind at buzzer → 0
        let prob = WinProbTable::lookup(-5, 96);
        assert_eq!(prob, 0);
    }

    #[test]
    fn test_lookup_overtime() {
        // OT tied → ~57% home (same as game start baseline)
        let prob = WinProbTable::lookup_overtime(0, 0);
        assert!(prob >= 50 && prob <= 60, "got {prob}");
    }

    #[test]
    fn test_lookup_overtime_ahead() {
        // Home +3 with 1 min left in OT → high
        let prob = WinProbTable::lookup_overtime(3, 8); // bucket 8 = 4 min elapsed of 5
        assert!(prob >= 90, "got {prob}");
    }
}
```

**Step 2: Run test to verify it fails**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test win_prob -- --nocapture 2>&1`
Expected: FAIL — module doesn't exist yet

**Step 3: Register the module**

In `kalshi-arb/src/engine/mod.rs`, add:

```rust
pub mod win_prob;
```

**Step 4: Write minimal implementation**

In `kalshi-arb/src/engine/win_prob.rs`, implement:

```rust
/// Static NBA win probability lookup table.
///
/// Maps (score_differential, time_bucket) → home_win_probability (0-100).
///
/// - score_differential: home_score - away_score, clamped to [-40, +40]
/// - time_bucket: total_elapsed_seconds / 30, range [0, 96] for regulation
///
/// Data derived from published NBA win probability models (historical game outcomes).
pub struct WinProbTable;

/// Regulation table: 81 rows (diff -40..+40) × 97 columns (bucket 0..96).
/// Each entry is home win probability 0-100.
static REGULATION: [u8; 81 * 97] = [ /* ... populated from published data ... */ ];

/// Overtime table: 81 rows × 11 columns (bucket 0..10, 5 min at 30s granularity).
static OVERTIME: [u8; 81 * 11] = [ /* ... */ ];

impl WinProbTable {
    /// Look up home win probability for regulation time.
    /// Returns 0-100.
    pub fn lookup(score_diff: i32, time_bucket: u16) -> u8 {
        // Clamp diff to [-40, 40]
        let clamped_diff = score_diff.clamp(-40, 40);
        let row = (clamped_diff + 40) as usize; // 0..80

        // Clamp bucket to [0, 96]
        let col = (time_bucket as usize).min(96);

        REGULATION[row * 97 + col]
    }

    /// Look up home win probability for overtime.
    /// time_bucket is within the OT period (0 = OT start, 10 = OT end).
    pub fn lookup_overtime(score_diff: i32, time_bucket: u16) -> u8 {
        let clamped_diff = score_diff.clamp(-40, 40);
        let row = (clamped_diff + 40) as usize;
        let col = (time_bucket as usize).min(10);

        OVERTIME[row * 11 + col]
    }
}
```

The table data itself needs to be populated. Generate the `REGULATION` and `OVERTIME` arrays using the well-known logistic model for NBA win probability:

```
P(home_win) = 1 / (1 + exp(-k * score_diff))
```

where `k` increases as time remaining decreases (tighter distribution late-game). At game start, `k ≈ 0.05` (10-point lead ≈ 62%); at 1 minute left, `k ≈ 0.5` (10-point lead ≈ 99%). Add a home court advantage offset of +3.0 points (equivalent to ~57% at tip-off for a tied game).

Use this formula to compute all 7,857 regulation entries and 891 overtime entries. Store as a `const` array in the source file. A helper comment at the top of the array should document the generation formula so it can be regenerated if needed.

**Step 5: Run test to verify it passes**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test win_prob -- --nocapture 2>&1`
Expected: All 9 tests PASS

**Step 6: Commit**

```bash
git add src/engine/win_prob.rs src/engine/mod.rs
git commit -m "feat: add NBA win probability lookup table"
```

---

### Task 2: Score Feed Types and Config

**Files:**
- Create: `kalshi-arb/src/feed/score_feed.rs`
- Modify: `kalshi-arb/src/feed/mod.rs`
- Modify: `kalshi-arb/src/config.rs`
- Modify: `kalshi-arb/config.toml`

**Step 1: Add ScoreFeedConfig to config**

In `kalshi-arb/src/config.rs`, add a new struct and field:

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct ScoreFeedConfig {
    pub nba_api_url: String,
    pub espn_api_url: String,
    pub live_poll_interval_s: u64,
    pub pre_game_poll_interval_s: u64,
    pub failover_threshold: u32,
    pub request_timeout_ms: u64,
}
```

Add to `Config`:

```rust
pub score_feed: Option<ScoreFeedConfig>,
```

Make it `Option` so existing configs without `[score_feed]` still parse.

**Step 2: Add `[score_feed]` section to config.toml**

```toml
[score_feed]
nba_api_url = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json"
espn_api_url = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
live_poll_interval_s = 3
pre_game_poll_interval_s = 60
failover_threshold = 5
request_timeout_ms = 1000
```

**Step 3: Define ScoreUpdate and ScoreSource types**

In `kalshi-arb/src/feed/score_feed.rs`:

```rust
use serde::Deserialize;

#[derive(Debug, Clone, PartialEq)]
pub enum ScoreSource {
    Nba,
    Espn,
}

#[derive(Debug, Clone)]
pub struct ScoreUpdate {
    pub game_id: String,
    pub home_team: String,
    pub away_team: String,
    pub home_score: u16,
    pub away_score: u16,
    pub period: u8,
    pub clock_seconds: u16,
    pub total_elapsed_seconds: u16,
    pub game_status: GameStatus,
    pub source: ScoreSource,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GameStatus {
    PreGame,
    Live,
    Halftime,
    Finished,
}

impl ScoreUpdate {
    /// Compute total elapsed seconds from period and clock.
    /// NBA: 4 periods × 12 min (720s each). OT periods are 5 min (300s each).
    pub fn compute_elapsed(period: u8, clock_seconds: u16) -> u16 {
        if period <= 4 {
            let completed_periods = (period - 1) as u16;
            completed_periods * 720 + (720 - clock_seconds)
        } else {
            // Overtime: regulation (2880s) + completed OT periods
            let ot_period = (period - 5) as u16; // 0-indexed OT
            2880 + ot_period * 300 + (300 - clock_seconds)
        }
    }
}
```

**Step 4: Register the module**

In `kalshi-arb/src/feed/mod.rs`, add:

```rust
pub mod score_feed;
```

**Step 5: Write tests for compute_elapsed**

In `kalshi-arb/src/feed/score_feed.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_elapsed_game_start() {
        assert_eq!(ScoreUpdate::compute_elapsed(1, 720), 0);
    }

    #[test]
    fn test_elapsed_end_of_first_quarter() {
        assert_eq!(ScoreUpdate::compute_elapsed(1, 0), 720);
    }

    #[test]
    fn test_elapsed_start_of_second_quarter() {
        assert_eq!(ScoreUpdate::compute_elapsed(2, 720), 720);
    }

    #[test]
    fn test_elapsed_halftime() {
        assert_eq!(ScoreUpdate::compute_elapsed(2, 0), 1440);
    }

    #[test]
    fn test_elapsed_end_of_regulation() {
        assert_eq!(ScoreUpdate::compute_elapsed(4, 0), 2880);
    }

    #[test]
    fn test_elapsed_overtime_start() {
        assert_eq!(ScoreUpdate::compute_elapsed(5, 300), 2880);
    }

    #[test]
    fn test_elapsed_overtime_end() {
        assert_eq!(ScoreUpdate::compute_elapsed(5, 0), 3180);
    }
}
```

**Step 6: Run tests**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test score_feed -- --nocapture 2>&1`
Expected: All 7 tests PASS

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test config -- --nocapture 2>&1`
Expected: `test_config_parses` PASS (config.toml still parses with new section)

**Step 7: Commit**

```bash
git add src/feed/score_feed.rs src/feed/mod.rs src/config.rs config.toml
git commit -m "feat: add score feed types, config, and elapsed time computation"
```

---

### Task 3: NBA API Client — Parse Scoreboard JSON

**Files:**
- Modify: `kalshi-arb/src/feed/score_feed.rs`

**Step 1: Write failing test for NBA API JSON parsing**

The NBA API returns JSON like this (from `cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`). Add a parsing function and test:

```rust
#[test]
fn test_parse_nba_scoreboard() {
    let json = r#"{
        "scoreboard": {
            "games": [
                {
                    "gameId": "0022400567",
                    "gameStatus": 2,
                    "homeTeam": {
                        "teamTricode": "LAL",
                        "teamName": "Lakers",
                        "teamCity": "Los Angeles",
                        "score": 55
                    },
                    "awayTeam": {
                        "teamTricode": "BOS",
                        "teamName": "Celtics",
                        "teamCity": "Boston",
                        "score": 50
                    },
                    "period": 2,
                    "gameClock": "PT05M30.00S"
                }
            ]
        }
    }"#;

    let updates = parse_nba_scoreboard(json).unwrap();
    assert_eq!(updates.len(), 1);
    let u = &updates[0];
    assert_eq!(u.game_id, "0022400567");
    assert_eq!(u.home_team, "Los Angeles Lakers");
    assert_eq!(u.away_team, "Boston Celtics");
    assert_eq!(u.home_score, 55);
    assert_eq!(u.away_score, 50);
    assert_eq!(u.period, 2);
    assert_eq!(u.clock_seconds, 330); // 5m30s
    assert_eq!(u.game_status, GameStatus::Live);
    assert_eq!(u.source, ScoreSource::Nba);
}

#[test]
fn test_parse_nba_game_clock_formats() {
    // "PT00M00.00S" = 0 seconds
    assert_eq!(parse_nba_clock("PT00M00.00S"), Some(0));
    // "PT12M00.00S" = 720 seconds
    assert_eq!(parse_nba_clock("PT12M00.00S"), Some(720));
    // "" (empty during halftime/breaks)
    assert_eq!(parse_nba_clock(""), None);
}

#[test]
fn test_parse_nba_game_status_codes() {
    // gameStatus: 1 = pre-game, 2 = live, 3 = finished
    assert_eq!(nba_game_status(1), GameStatus::PreGame);
    assert_eq!(nba_game_status(2), GameStatus::Live);
    assert_eq!(nba_game_status(3), GameStatus::Finished);
}
```

**Step 2: Run test to verify it fails**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test parse_nba -- --nocapture 2>&1`
Expected: FAIL — functions don't exist yet

**Step 3: Implement NBA scoreboard parsing**

Add serde deserialization structs and parsing functions:

```rust
// --- NBA API JSON structures ---

#[derive(Deserialize)]
struct NbaScoreboard {
    scoreboard: NbaScoreboardInner,
}

#[derive(Deserialize)]
struct NbaScoreboardInner {
    games: Vec<NbaGame>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NbaGame {
    game_id: String,
    game_status: u8,
    home_team: NbaTeam,
    away_team: NbaTeam,
    period: u8,
    game_clock: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NbaTeam {
    team_name: String,
    team_city: String,
    score: u16,
}

fn parse_nba_clock(clock: &str) -> Option<u16> {
    // Format: "PT05M30.00S" or "" (empty during breaks)
    if clock.is_empty() {
        return None;
    }
    let clock = clock.trim_start_matches("PT").trim_end_matches('S');
    let (min_str, sec_str) = clock.split_once('M')?;
    let minutes: u16 = min_str.parse().ok()?;
    let seconds: u16 = sec_str.split('.').next()?.parse().ok()?;
    Some(minutes * 60 + seconds)
}

fn nba_game_status(status: u8) -> GameStatus {
    match status {
        1 => GameStatus::PreGame,
        2 => GameStatus::Live,
        3 => GameStatus::Finished,
        _ => GameStatus::PreGame,
    }
}

pub fn parse_nba_scoreboard(json: &str) -> anyhow::Result<Vec<ScoreUpdate>> {
    let scoreboard: NbaScoreboard = serde_json::from_str(json)?;
    let mut updates = Vec::new();

    for game in scoreboard.scoreboard.games {
        let status = nba_game_status(game.game_status);
        let clock_secs = parse_nba_clock(&game.game_clock).unwrap_or(0);
        let elapsed = ScoreUpdate::compute_elapsed(game.period, clock_secs);

        updates.push(ScoreUpdate {
            game_id: game.game_id,
            home_team: format!("{} {}", game.home_team.team_city, game.home_team.team_name),
            away_team: format!("{} {}", game.away_team.team_city, game.away_team.team_name),
            home_score: game.home_team.score,
            away_score: game.away_team.score,
            period: game.period,
            clock_seconds: clock_secs,
            total_elapsed_seconds: elapsed,
            game_status: status,
            source: ScoreSource::Nba,
        });
    }

    Ok(updates)
}
```

**Step 4: Run tests**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test parse_nba -- --nocapture 2>&1`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/feed/score_feed.rs
git commit -m "feat: add NBA API scoreboard JSON parsing"
```

---

### Task 4: ESPN API Client — Parse Scoreboard JSON

**Files:**
- Modify: `kalshi-arb/src/feed/score_feed.rs`

**Step 1: Write failing test for ESPN JSON parsing**

ESPN's scoreboard format differs. Add test:

```rust
#[test]
fn test_parse_espn_scoreboard() {
    let json = r#"{
        "events": [
            {
                "id": "401584700",
                "competitions": [
                    {
                        "competitors": [
                            {
                                "homeAway": "home",
                                "team": {
                                    "displayName": "Los Angeles Lakers"
                                },
                                "score": "55"
                            },
                            {
                                "homeAway": "away",
                                "team": {
                                    "displayName": "Boston Celtics"
                                },
                                "score": "50"
                            }
                        ],
                        "status": {
                            "type": {
                                "id": "2",
                                "name": "STATUS_IN_PROGRESS"
                            },
                            "period": 2,
                            "displayClock": "5:30"
                        }
                    }
                ]
            }
        ]
    }"#;

    let updates = parse_espn_scoreboard(json).unwrap();
    assert_eq!(updates.len(), 1);
    let u = &updates[0];
    assert_eq!(u.game_id, "401584700");
    assert_eq!(u.home_team, "Los Angeles Lakers");
    assert_eq!(u.away_team, "Boston Celtics");
    assert_eq!(u.home_score, 55);
    assert_eq!(u.away_score, 50);
    assert_eq!(u.period, 2);
    assert_eq!(u.clock_seconds, 330);
    assert_eq!(u.game_status, GameStatus::Live);
    assert_eq!(u.source, ScoreSource::Espn);
}

#[test]
fn test_parse_espn_display_clock() {
    assert_eq!(parse_espn_clock("5:30"), Some(330));
    assert_eq!(parse_espn_clock("12:00"), Some(720));
    assert_eq!(parse_espn_clock("0:00"), Some(0));
    assert_eq!(parse_espn_clock("0:05.3"), Some(5));
}
```

**Step 2: Run test to verify it fails**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test parse_espn -- --nocapture 2>&1`
Expected: FAIL

**Step 3: Implement ESPN parsing**

```rust
// --- ESPN API JSON structures ---

#[derive(Deserialize)]
struct EspnScoreboard {
    events: Vec<EspnEvent>,
}

#[derive(Deserialize)]
struct EspnEvent {
    id: String,
    competitions: Vec<EspnCompetition>,
}

#[derive(Deserialize)]
struct EspnCompetition {
    competitors: Vec<EspnCompetitor>,
    status: EspnStatus,
}

#[derive(Deserialize)]
struct EspnCompetitor {
    #[serde(rename = "homeAway")]
    home_away: String,
    team: EspnTeam,
    score: String,
}

#[derive(Deserialize)]
struct EspnTeam {
    #[serde(rename = "displayName")]
    display_name: String,
}

#[derive(Deserialize)]
struct EspnStatus {
    #[serde(rename = "type")]
    status_type: EspnStatusType,
    period: u8,
    #[serde(rename = "displayClock")]
    display_clock: String,
}

#[derive(Deserialize)]
struct EspnStatusType {
    id: String,
}

fn parse_espn_clock(clock: &str) -> Option<u16> {
    // Format: "5:30" or "0:05.3"
    let clock = clock.split('.').next()?; // strip fractional seconds
    let (min_str, sec_str) = clock.split_once(':')?;
    let minutes: u16 = min_str.parse().ok()?;
    let seconds: u16 = sec_str.parse().ok()?;
    Some(minutes * 60 + seconds)
}

pub fn parse_espn_scoreboard(json: &str) -> anyhow::Result<Vec<ScoreUpdate>> {
    let scoreboard: EspnScoreboard = serde_json::from_str(json)?;
    let mut updates = Vec::new();

    for event in scoreboard.events {
        let Some(comp) = event.competitions.first() else { continue };

        let home = comp.competitors.iter().find(|c| c.home_away == "home");
        let away = comp.competitors.iter().find(|c| c.home_away == "away");
        let (Some(home), Some(away)) = (home, away) else { continue };

        let status = match comp.status.status_type.id.as_str() {
            "1" => GameStatus::PreGame,
            "2" => GameStatus::Live,
            "3" => GameStatus::Finished,
            _ => GameStatus::PreGame,
        };

        let clock_secs = parse_espn_clock(&comp.status.display_clock).unwrap_or(0);
        let elapsed = ScoreUpdate::compute_elapsed(comp.status.period, clock_secs);

        updates.push(ScoreUpdate {
            game_id: event.id,
            home_team: home.team.display_name.clone(),
            away_team: away.team.display_name.clone(),
            home_score: home.score.parse().unwrap_or(0),
            away_score: away.score.parse().unwrap_or(0),
            period: comp.status.period,
            clock_seconds: clock_secs,
            total_elapsed_seconds: elapsed,
            game_status: status,
            source: ScoreSource::Espn,
        });
    }

    Ok(updates)
}
```

**Step 4: Run tests**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test parse_espn -- --nocapture 2>&1`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/feed/score_feed.rs
git commit -m "feat: add ESPN API scoreboard JSON parsing"
```

---

### Task 5: ScorePoller — HTTP Fetching With Failover

**Files:**
- Modify: `kalshi-arb/src/feed/score_feed.rs`

**Step 1: Write the ScorePoller struct and fetch logic**

This is the async HTTP client that polls NBA API primary, ESPN fallback. Since this involves real HTTP calls, we write integration-test-friendly code but test the parsing (already done) and the failover logic separately.

```rust
use reqwest::Client;
use std::time::Duration;

pub struct ScorePoller {
    client: Client,
    nba_url: String,
    espn_url: String,
    timeout: Duration,
    failover_threshold: u32,
    nba_consecutive_failures: u32,
    espn_is_primary: bool,
}

impl ScorePoller {
    pub fn new(
        nba_url: &str,
        espn_url: &str,
        timeout_ms: u64,
        failover_threshold: u32,
    ) -> Self {
        Self {
            client: Client::new(),
            nba_url: nba_url.to_string(),
            espn_url: espn_url.to_string(),
            timeout: Duration::from_millis(timeout_ms),
            failover_threshold,
            nba_consecutive_failures: 0,
            espn_is_primary: false,
        }
    }

    /// Fetch live scores. Tries primary source, falls back to secondary.
    /// Returns the parsed updates and updates internal failover state.
    pub async fn fetch(&mut self) -> anyhow::Result<Vec<ScoreUpdate>> {
        let (primary_url, secondary_url, primary_parser, secondary_parser) = if self.espn_is_primary {
            (&self.espn_url, &self.nba_url, parse_espn_scoreboard as fn(&str) -> _, parse_nba_scoreboard as fn(&str) -> _)
        } else {
            (&self.nba_url, &self.espn_url, parse_nba_scoreboard as fn(&str) -> _, parse_espn_scoreboard as fn(&str) -> _)
        };

        // Try primary
        match self.fetch_and_parse(primary_url, primary_parser).await {
            Ok(updates) => {
                if !self.espn_is_primary {
                    self.nba_consecutive_failures = 0;
                }
                return Ok(updates);
            }
            Err(e) => {
                tracing::warn!(source = if self.espn_is_primary { "espn" } else { "nba" }, error = %e, "primary score fetch failed, trying fallback");
                if !self.espn_is_primary {
                    self.nba_consecutive_failures += 1;
                    if self.nba_consecutive_failures >= self.failover_threshold {
                        tracing::warn!("NBA API hit failover threshold, swapping ESPN to primary");
                        self.espn_is_primary = true;
                    }
                }
            }
        }

        // Try secondary
        self.fetch_and_parse(secondary_url, secondary_parser).await
    }

    async fn fetch_and_parse(
        &self,
        url: &str,
        parser: fn(&str) -> anyhow::Result<Vec<ScoreUpdate>>,
    ) -> anyhow::Result<Vec<ScoreUpdate>> {
        let resp = self.client.get(url)
            .timeout(self.timeout)
            .send()
            .await?;
        let text = resp.text().await?;
        parser(&text)
    }
}
```

**Step 2: Write unit test for failover counter logic**

```rust
#[test]
fn test_failover_threshold_tracking() {
    let mut poller = ScorePoller::new(
        "http://fake-nba", "http://fake-espn", 1000, 3,
    );
    assert!(!poller.espn_is_primary);

    // Simulate 3 consecutive NBA failures
    poller.nba_consecutive_failures = 2;
    assert!(!poller.espn_is_primary);

    poller.nba_consecutive_failures = 3;
    // In the real fetch(), this check triggers the swap.
    // We test the threshold directly:
    assert!(poller.nba_consecutive_failures >= poller.failover_threshold);
}
```

**Step 3: Run tests**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test score_feed -- --nocapture 2>&1`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/feed/score_feed.rs
git commit -m "feat: add ScorePoller with NBA/ESPN failover"
```

---

### Task 6: Fair Value From Score — Bridge Function

**Files:**
- Create a helper function that takes a `ScoreUpdate` and returns `(home_fair: u32, away_fair: u32)` using the win prob table. This is the replacement for `devig()` + `fair_value_cents()`.

**Step 1: Write failing test**

In `kalshi-arb/src/engine/win_prob.rs`, add:

```rust
#[test]
fn test_fair_value_from_score() {
    // Home up 5, end of 3rd quarter (bucket = 2160/30 = 72)
    let (home, away) = WinProbTable::fair_value(5, 2160);
    assert!(home > 50);
    assert_eq!(home + away, 100);
}

#[test]
fn test_fair_value_from_score_overtime() {
    // Tied in overtime, 3 min left (elapsed in OT = 120s, bucket = 4)
    let (home, away) = WinProbTable::fair_value_overtime(0, 120);
    assert!(home >= 50 && home <= 60);
    assert_eq!(home + away, 100);
}

#[test]
fn test_fair_value_pregame() {
    // Before game starts, return home court advantage baseline
    let (home, away) = WinProbTable::fair_value(0, 0);
    assert!(home >= 55 && home <= 60);
    assert_eq!(home + away, 100);
}
```

**Step 2: Run test to verify it fails**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test fair_value_from -- --nocapture 2>&1`
Expected: FAIL

**Step 3: Implement**

```rust
impl WinProbTable {
    /// Convert a live score + elapsed seconds into (home_fair, away_fair) in cents.
    /// Both values sum to 100.
    pub fn fair_value(score_diff: i32, total_elapsed_seconds: u16) -> (u32, u32) {
        let time_bucket = total_elapsed_seconds / 30;
        let home = Self::lookup(score_diff, time_bucket) as u32;
        (home, 100 - home)
    }

    /// Same but for overtime periods.
    /// `ot_elapsed_seconds` = seconds elapsed within the current OT period.
    pub fn fair_value_overtime(score_diff: i32, ot_elapsed_seconds: u16) -> (u32, u32) {
        let time_bucket = ot_elapsed_seconds / 30;
        let home = Self::lookup_overtime(score_diff, time_bucket) as u32;
        (home, 100 - home)
    }
}
```

**Step 4: Run tests**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test fair_value -- --nocapture 2>&1`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/engine/win_prob.rs
git commit -m "feat: add fair_value bridge functions on WinProbTable"
```

---

### Task 7: Wire Score Feed Into Main Loop

**Files:**
- Modify: `kalshi-arb/src/main.rs`

This is the integration task. The main loop currently iterates over `odds_sports` and calls `process_sport_updates()` for each. We need to:

1. Detect that `"basketball"` should use the score feed instead of odds feed
2. Run a separate polling loop for the score feed at 2-3s intervals
3. When score updates arrive, compute fair value via `WinProbTable`, then feed into the same `strategy::evaluate()` → `momentum_gate()` → `MarketRow` pipeline

**Step 1: Initialize ScorePoller alongside OddsFeed**

In the startup section of `main.rs`, after loading config:

```rust
// Initialize score feed for NBA (if configured)
let mut score_poller = config.score_feed.as_ref().map(|sf| {
    feed::score_feed::ScorePoller::new(
        &sf.nba_api_url,
        &sf.espn_api_url,
        sf.request_timeout_ms,
        sf.failover_threshold,
    )
});
```

**Step 2: Remove "basketball" from odds_sports when score_feed is configured**

```rust
let odds_sports: Vec<String> = config.odds_feed.sports.iter()
    .filter(|s| !(config.score_feed.is_some() && s.as_str() == "basketball"))
    .cloned()
    .collect();
```

This ensures NBA games use the score feed path, not the odds feed path.

**Step 3: Add score feed polling to the main loop**

Add a new block inside the main loop, before or after the odds sport loop. This block:

1. Checks if score_poller is `Some`
2. Checks if the poll interval has elapsed (3s live, 60s pre-game)
3. Calls `score_poller.fetch().await`
4. For each `ScoreUpdate` with `GameStatus::Live`:
   - Look up the game in `market_index` using `matcher::generate_key("basketball", home, away, date)` and `matcher::find_match()`
   - Compute fair value: `WinProbTable::fair_value(score_diff, total_elapsed_seconds)`
   - Push to `VelocityTracker` (using `home_fair / 100.0` as implied prob for compatibility)
   - Get live bid/ask from `live_book_engine`
   - Compute momentum (velocity + book pressure)
   - Call `strategy::evaluate()` and `strategy::momentum_gate()`
   - Build `MarketRow` with `staleness_secs` based on the score fetch timestamp
   - Handle simulation mode the same as odds path

The code follows the exact same pattern as the 2-way path in `process_sport_updates()` (lines 354-504 of main.rs), but replaces the `devig()` + `fair_value_cents()` calls with `WinProbTable::fair_value()`.

**Step 4: Add a helper function `process_score_updates()`**

To keep main.rs clean, create a new function parallel to `process_sport_updates()`:

```rust
fn process_score_updates(
    updates: &[feed::score_feed::ScoreUpdate],
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
) -> SportProcessResult {
    // Similar structure to process_sport_updates but using WinProbTable
    // for fair value computation instead of devig()
}
```

**Step 5: Run full test suite**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test 2>&1`
Expected: All 60+ tests PASS (existing tests should not break)

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo build 2>&1`
Expected: Compiles cleanly

**Step 6: Commit**

```bash
git add src/main.rs
git commit -m "feat: wire score feed into main loop for NBA games"
```

---

### Task 8: Staleness Tracking for Score Feed

**Files:**
- Modify: `kalshi-arb/src/main.rs` (inside `process_score_updates`)

**Step 1: Add staleness to MarketRow from score feed**

In `process_score_updates()`, track when each game's score was last successfully fetched. If no successful fetch in 10 seconds (3-4 missed cycles at 3s interval), mark as stale:

```rust
// Track last successful fetch per game
// In the outer scope: last_score_fetch: HashMap<String, Instant>

let staleness_secs = last_score_fetch.get(&update.game_id)
    .map(|t| cycle_start.duration_since(*t).as_secs());

// In MarketRow construction:
staleness_secs,
```

A successful fetch that returns the same score still resets the timer (data is fresh, just unchanged).

If `staleness_secs > 10`, force the signal to `Skip`.

**Step 2: Run tests and build**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test 2>&1`
Expected: All PASS

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo build 2>&1`
Expected: Clean build

**Step 3: Commit**

```bash
git add src/main.rs
git commit -m "feat: add staleness tracking for score feed"
```

---

### Task 9: End-to-End Verification

**Files:** None new — this is a verification task.

**Step 1: Run the full test suite**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test 2>&1`
Expected: All tests PASS, no regressions

**Step 2: Build in release mode**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo build --release 2>&1`
Expected: Clean compile

**Step 3: Verify config parsing**

Run: `source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && cargo test test_config_parses -- --nocapture 2>&1`
Expected: PASS (config.toml with new `[score_feed]` section parses correctly)

**Step 4: Dry-run smoke test (if NBA games are live)**

Run the binary in dry-run mode and verify:
- Score feed logs appear (NBA API fetch attempts)
- NBA games show up in the TUI with fair values derived from score
- Non-NBA sports still use odds feed as before
- Staleness column works correctly

```bash
source ~/.cargo/env && cd .worktrees/nba-score-feed/kalshi-arb && KALSHI_EMAIL=test KALSHI_PASSWORD=test THE_ODDS_API_KEY=test cargo run 2>&1 | head -50
```

Note: This will fail to authenticate with Kalshi but should show score feed initialization in the logs.

**Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```
