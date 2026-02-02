// Diagnostic utilities for building multi-source diagnostic views

use crate::engine::matcher;
use crate::feed::score_feed::ScoreUpdate;
use crate::feed::types::OddsUpdate;

/// Diagnostic row data for TUI display
#[derive(Debug, Clone)]
pub struct DiagnosticRow {
    pub sport: String,
    pub matchup: String,
    pub commence_time: String,
    pub game_status: String,
    pub kalshi_ticker: Option<String>,
    pub market_status: Option<String>,
    pub reason: String,
    pub source: String,
}

/// Extract last name from a full name (used for MMA fighter names)
fn last_name(full_name: &str) -> &str {
    full_name.split_whitespace().last().unwrap_or(full_name)
}

/// Build diagnostic rows from all odds updates for a given sport.
pub fn build_diagnostic_rows(
    updates: &[OddsUpdate],
    sport: &str,
    market_index: &matcher::MarketIndex,
    source_name: &str,
) -> Vec<DiagnosticRow> {
    let eastern = chrono::FixedOffset::west_opt(5 * 3600)
        .unwrap_or_else(|| chrono::FixedOffset::west_opt(0).unwrap());
    let now_utc = chrono::Utc::now();

    updates
        .iter()
        .map(|update| {
            let matchup = format!("{} @ {}", update.away_team, update.home_team);

            let commence_et = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
                .ok()
                .map(|dt| dt.with_timezone(&eastern).format("%b %d %H:%M").to_string())
                .unwrap_or_else(|| update.commence_time.clone());

            let commence_dt = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
                .ok()
                .map(|dt| dt.with_timezone(&chrono::Utc));

            let game_status = match commence_dt {
                Some(ct) if ct <= now_utc => "Live".to_string(),
                Some(ct) => {
                    let diff = ct - now_utc;
                    let total_secs = diff.num_seconds().max(0) as u64;
                    let h = total_secs / 3600;
                    let m = (total_secs % 3600) / 60;
                    if h > 0 {
                        format!("Upcoming ({}h {:02}m)", h, m)
                    } else {
                        format!("Upcoming ({}m)", m)
                    }
                }
                None => "Unknown".to_string(),
            };

            let date = chrono::DateTime::parse_from_rfc3339(&update.commence_time)
                .ok()
                .map(|dt| dt.with_timezone(&eastern).date_naive());

            let (lookup_home, lookup_away) = if sport == "mma" {
                (
                    last_name(&update.home_team).to_string(),
                    last_name(&update.away_team).to_string(),
                )
            } else {
                (update.home_team.clone(), update.away_team.clone())
            };

            let matched_game = date.and_then(|d| {
                matcher::generate_key(sport, &lookup_home, &lookup_away, d)
                    .and_then(|k| market_index.get(&k))
            });

            let (kalshi_ticker, market_status, reason) = match matched_game {
                Some(game) => {
                    let side = game
                        .home
                        .as_ref()
                        .or(game.away.as_ref())
                        .or(game.draw.as_ref());

                    match side {
                        Some(sm) => {
                            let market_st = if sm.status == "open" || sm.status == "active" {
                                "Open"
                            } else {
                                "Closed"
                            };
                            let reason = if game_status.starts_with("Live") {
                                "Live & tradeable".to_string()
                            } else {
                                "Not started yet".to_string()
                            };
                            (Some(sm.ticker.clone()), Some(market_st.to_string()), reason)
                        }
                        None => (None, None, "No match found".to_string()),
                    }
                }
                None => (None, None, "No match found".to_string()),
            };

            DiagnosticRow {
                sport: sport.to_string(),
                matchup,
                commence_time: commence_et,
                game_status,
                kalshi_ticker,
                market_status,
                reason,
                source: source_name.to_string(),
            }
        })
        .collect()
}

/// Build diagnostic rows from score updates for a given sport.
pub fn build_diagnostic_rows_from_scores(
    updates: &[ScoreUpdate],
    sport: &str,
    market_index: &matcher::MarketIndex,
    source_name: &str,
) -> Vec<DiagnosticRow> {
    let eastern = chrono::FixedOffset::west_opt(5 * 3600)
        .unwrap_or_else(|| chrono::FixedOffset::west_opt(0).unwrap());

    updates
        .iter()
        .map(|update| {
            let matchup = format!("{} vs {}", update.away_team, update.home_team);

            // Format commence time: for score feeds we don't have it, use "—"
            // Game status from ScoreUpdate
            let game_status = match &update.game_status {
                crate::feed::score_feed::GameStatus::PreGame => "Pre-Game".to_string(),
                crate::feed::score_feed::GameStatus::Live => {
                    let clock_mins = update.clock_seconds / 60;
                    let clock_secs = update.clock_seconds % 60;
                    format!(
                        "Live (P{} {}:{:02} {}-{})",
                        update.period, clock_mins, clock_secs, update.home_score, update.away_score
                    )
                }
                crate::feed::score_feed::GameStatus::Halftime => "Halftime".to_string(),
                crate::feed::score_feed::GameStatus::Finished => "Final".to_string(),
            };

            // Score feeds don't have a scheduled commence time in the struct,
            // so we use a placeholder
            let commence_time = "—".to_string();

            // Try to match against Kalshi markets
            // We don't have a date from ScoreUpdate, so we'll use today's date
            let today = chrono::Utc::now().with_timezone(&eastern).date_naive();

            let (lookup_home, lookup_away) = if sport == "mma" {
                (
                    last_name(&update.home_team).to_string(),
                    last_name(&update.away_team).to_string(),
                )
            } else {
                (update.home_team.clone(), update.away_team.clone())
            };

            let matched_game = matcher::generate_key(sport, &lookup_home, &lookup_away, today)
                .and_then(|k| market_index.get(&k));

            let (kalshi_ticker, market_status, reason) = match matched_game {
                Some(game) => {
                    let side = game
                        .home
                        .as_ref()
                        .or(game.away.as_ref())
                        .or(game.draw.as_ref());

                    match side {
                        Some(sm) => {
                            let market_st = if sm.status == "open" || sm.status == "active" {
                                "Open"
                            } else {
                                "Closed"
                            };
                            let reason = if game_status.starts_with("Live") {
                                "Live & tradeable".to_string()
                            } else {
                                "Not started yet".to_string()
                            };
                            (Some(sm.ticker.clone()), Some(market_st.to_string()), reason)
                        }
                        None => (None, None, "No match found".to_string()),
                    }
                }
                None => (None, None, "No match found".to_string()),
            };

            DiagnosticRow {
                sport: sport.to_string(),
                matchup,
                commence_time,
                game_status,
                kalshi_ticker,
                market_status,
                reason,
                source: source_name.to_string(),
            }
        })
        .collect()
}
