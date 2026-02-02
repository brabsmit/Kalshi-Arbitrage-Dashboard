// Integration tests for multi-source diagnostic view

#[cfg(test)]
mod tests {
    use kalshi_arb::diagnostic::{build_diagnostic_rows, build_diagnostic_rows_from_scores};
    use kalshi_arb::feed::score_feed::{GameStatus, ScoreSource, ScoreUpdate};
    use kalshi_arb::feed::types::OddsUpdate;
    use std::collections::HashMap;

    #[test]
    fn test_diagnostic_rows_from_odds_source() {
        // Create a sample OddsUpdate
        let odds_update = OddsUpdate {
            event_id: "test-event-1".to_string(),
            sport: "basketball_ncaab".to_string(),
            home_team: "Duke".to_string(),
            away_team: "UNC".to_string(),
            commence_time: "2026-02-01T19:00:00Z".to_string(),
            bookmakers: vec![],
        };

        let market_index = HashMap::new();
        let rows = build_diagnostic_rows(
            &[odds_update],
            "basketball_ncaab",
            &market_index,
            "TheOddsAPI",
        );

        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.sport, "basketball_ncaab");
        assert_eq!(row.matchup, "UNC @ Duke");
        assert_eq!(row.source, "TheOddsAPI");
        assert!(!row.commence_time.is_empty());
        assert_eq!(row.reason, "No match found");
    }

    #[test]
    fn test_diagnostic_rows_from_score_source() {
        // Create a sample ScoreUpdate
        let score_update = ScoreUpdate {
            game_id: "test-game-1".to_string(),
            home_team: "Lakers".to_string(),
            away_team: "Warriors".to_string(),
            home_score: 100,
            away_score: 95,
            period: 2,
            clock_seconds: 420,
            total_elapsed_seconds: 2100,
            game_status: GameStatus::Live,
            source: ScoreSource::Espn,
        };

        let market_index = HashMap::new();
        let rows = build_diagnostic_rows_from_scores(
            &[score_update],
            "basketball_nba",
            &market_index,
            "ESPN",
        );

        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.sport, "basketball_nba");
        assert_eq!(row.matchup, "Warriors vs Lakers");
        assert_eq!(row.source, "ESPN");
        // Score feeds use placeholder for commence_time
        assert_eq!(row.commence_time, "—");
        // Game status should be "Live (P2 7:00 100-95)"
        assert!(row.game_status.starts_with("Live"));
        assert!(row.game_status.contains("100-95"));
        assert_eq!(row.reason, "No match found");
    }

    #[test]
    fn test_multi_source_diagnostic_rows_combined() {
        // Create odds update
        let odds_update = OddsUpdate {
            event_id: "test-event-1".to_string(),
            sport: "basketball_ncaab".to_string(),
            home_team: "Kentucky".to_string(),
            away_team: "Louisville".to_string(),
            commence_time: "2026-02-01T20:00:00Z".to_string(),
            bookmakers: vec![],
        };

        // Create score update
        let score_update = ScoreUpdate {
            game_id: "test-game-1".to_string(),
            home_team: "Kansas".to_string(),
            away_team: "Missouri".to_string(),
            home_score: 75,
            away_score: 70,
            period: 2,
            clock_seconds: 600,
            total_elapsed_seconds: 1800,
            game_status: GameStatus::Live,
            source: ScoreSource::Espn,
        };

        let market_index = HashMap::new();

        // Build rows from both sources
        let mut all_rows = Vec::new();
        all_rows.extend(build_diagnostic_rows(
            &[odds_update],
            "basketball_ncaab",
            &market_index,
            "TheOddsAPI",
        ));
        all_rows.extend(build_diagnostic_rows_from_scores(
            &[score_update],
            "basketball_ncaab",
            &market_index,
            "ESPN",
        ));

        // Verify we have rows from both sources
        assert_eq!(all_rows.len(), 2);

        // Find the odds row
        let odds_row = all_rows.iter().find(|r| r.source == "TheOddsAPI").unwrap();
        assert_eq!(odds_row.matchup, "Louisville @ Kentucky");
        assert!(!odds_row.commence_time.is_empty());
        assert_ne!(odds_row.commence_time, "—");

        // Find the score row
        let score_row = all_rows.iter().find(|r| r.source == "ESPN").unwrap();
        assert_eq!(score_row.matchup, "Missouri vs Kansas");
        assert_eq!(score_row.commence_time, "—");
        assert!(score_row.game_status.starts_with("Live"));
    }
}
