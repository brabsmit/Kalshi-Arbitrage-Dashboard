use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

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
    /// Neither NBA nor ESPN APIs explicitly report halftime as a distinct status
    /// (both return "Live" / status=2), but the variant is kept for future use
    /// if a source begins distinguishing halftime from active play.
    #[allow(dead_code)]
    Halftime,
    Finished,
}

impl ScoreUpdate {
    /// Compute total elapsed seconds from period and clock.
    /// NBA: 4 periods x 12 min (720s each). OT periods are 5 min (300s each).
    pub fn compute_elapsed(period: u8, clock_seconds: u16) -> u16 {
        if period == 0 {
            return 0;
        }
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

// ── NBA API Deserialization ──────────────────────────────────────────

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

// ── ESPN API Deserialization ─────────────────────────────────────────

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
    let clock = clock.split('.').next()?;
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

// ── ScorePoller — HTTP Fetching With Failover ──────────────────────

pub struct ScorePoller {
    client: Client,
    nba_url: String,
    espn_url: String,
    timeout: Duration,
    failover_threshold: u32,
    nba_consecutive_failures: u32,
    espn_is_primary: bool,
    /// Polls since ESPN became primary; used to periodically probe NBA for recovery.
    espn_primary_polls: u32,
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
            espn_primary_polls: 0,
        }
    }

    pub async fn fetch(&mut self) -> anyhow::Result<Vec<ScoreUpdate>> {
        // When ESPN is primary, periodically probe NBA API for recovery.
        // Every `failover_threshold` polls, try NBA first instead of ESPN.
        if self.espn_is_primary {
            self.espn_primary_polls += 1;
            if self.espn_primary_polls >= self.failover_threshold {
                self.espn_primary_polls = 0;
                if let Ok(updates) = self.fetch_and_parse(&self.nba_url.clone(), parse_nba_scoreboard).await {
                    tracing::info!("NBA API recovered, swapping back to primary");
                    self.espn_is_primary = false;
                    self.nba_consecutive_failures = 0;
                    return Ok(updates);
                }
            }
        }

        let (primary_url, secondary_url, primary_parser, secondary_parser) =
            if self.espn_is_primary {
                (
                    &self.espn_url,
                    &self.nba_url,
                    parse_espn_scoreboard as fn(&str) -> _,
                    parse_nba_scoreboard as fn(&str) -> _,
                )
            } else {
                (
                    &self.nba_url,
                    &self.espn_url,
                    parse_nba_scoreboard as fn(&str) -> _,
                    parse_espn_scoreboard as fn(&str) -> _,
                )
            };

        match self.fetch_and_parse(primary_url, primary_parser).await {
            Ok(updates) => {
                if !self.espn_is_primary {
                    self.nba_consecutive_failures = 0;
                }
                return Ok(updates);
            }
            Err(e) => {
                tracing::warn!(
                    source = if self.espn_is_primary { "espn" } else { "nba" },
                    error = %e,
                    "primary score fetch failed, trying fallback"
                );
                if !self.espn_is_primary {
                    self.nba_consecutive_failures += 1;
                    if self.nba_consecutive_failures >= self.failover_threshold {
                        tracing::warn!(
                            "NBA API hit failover threshold, swapping ESPN to primary"
                        );
                        self.espn_is_primary = true;
                        self.espn_primary_polls = 0;
                    }
                }
            }
        }

        self.fetch_and_parse(secondary_url, secondary_parser).await
    }

    async fn fetch_and_parse(
        &self,
        url: &str,
        parser: fn(&str) -> anyhow::Result<Vec<ScoreUpdate>>,
    ) -> anyhow::Result<Vec<ScoreUpdate>> {
        let resp = self.client.get(url).timeout(self.timeout).send().await?;
        let text = resp.text().await?;
        parser(&text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_elapsed_period_zero() {
        assert_eq!(ScoreUpdate::compute_elapsed(0, 0), 0);
        assert_eq!(ScoreUpdate::compute_elapsed(0, 720), 0);
    }

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
        assert_eq!(u.clock_seconds, 330);
        assert_eq!(u.game_status, GameStatus::Live);
        assert_eq!(u.source, ScoreSource::Nba);
    }

    #[test]
    fn test_parse_nba_game_clock_formats() {
        assert_eq!(parse_nba_clock("PT00M00.00S"), Some(0));
        assert_eq!(parse_nba_clock("PT12M00.00S"), Some(720));
        assert_eq!(parse_nba_clock(""), None);
    }

    #[test]
    fn test_parse_nba_game_status_codes() {
        assert_eq!(nba_game_status(1), GameStatus::PreGame);
        assert_eq!(nba_game_status(2), GameStatus::Live);
        assert_eq!(nba_game_status(3), GameStatus::Finished);
    }

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

    #[test]
    fn test_failover_threshold_tracking() {
        let mut poller = ScorePoller::new("http://fake-nba", "http://fake-espn", 1000, 3);
        assert!(!poller.espn_is_primary);
        poller.nba_consecutive_failures = 2;
        assert!(!poller.espn_is_primary);
        poller.nba_consecutive_failures = 3;
        assert!(poller.nba_consecutive_failures >= poller.failover_threshold);
    }

    #[test]
    fn test_recovery_probe_counter() {
        let mut poller = ScorePoller::new("http://fake-nba", "http://fake-espn", 1000, 3);
        poller.espn_is_primary = true;
        poller.espn_primary_polls = 0;
        // Counter increments each poll cycle; resets at failover_threshold
        poller.espn_primary_polls += 1;
        assert_eq!(poller.espn_primary_polls, 1);
        poller.espn_primary_polls += 1;
        poller.espn_primary_polls += 1;
        assert!(poller.espn_primary_polls >= poller.failover_threshold);
    }
}
