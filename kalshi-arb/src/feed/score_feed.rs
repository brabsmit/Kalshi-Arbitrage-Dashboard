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
    /// NBA: 4 periods x 12 min (720s each). OT periods are 5 min (300s each).
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
