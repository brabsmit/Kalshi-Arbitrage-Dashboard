//! NBA win-probability lookup using a logistic model.
//!
//! Converts a live score differential + game-clock time-bucket into a home-team
//! win probability (0-100).  Used by the main loop to derive fair value from
//! game state without sportsbook odds.
//!
//! Model: `P(home_win) = 1 / (1 + exp(-k * adjusted_diff))`
//!   - `adjusted_diff = score_diff + home_advantage`
//!   - `k` ramps cubically so late-game leads are near-certain while
//!     mid-game probabilities stay realistic (calibrated to NBA data).

/// Parameterized win-probability model.
#[derive(Debug, Clone)]
pub struct WinProbTable {
    home_advantage: f64,
    k_start: f64,
    k_range: f64,
    ot_k_start: f64,
    ot_k_range: f64,
}

impl WinProbTable {
    pub fn new(home_advantage: f64, k_start: f64, k_range: f64, ot_k_start: f64, ot_k_range: f64) -> Self {
        Self { home_advantage, k_start, k_range, ot_k_start, ot_k_range }
    }

    /// Convenience constructor from config.
    pub fn from_config(config: &crate::config::WinProbConfig) -> Self {
        Self::new(config.home_advantage, config.k_start, config.k_range, config.ot_k_start, config.ot_k_range)
    }

    /// Regulation lookup.
    ///
    /// * `score_diff` -- home score minus away score (clamped to -40..=40).
    /// * `time_bucket` -- 0 = game start, 96 = end of regulation (each bucket
    ///   = 30 seconds of game clock elapsed).
    ///
    /// Returns a probability 0-100 (u8).
    pub fn lookup(&self, score_diff: i32, time_bucket: u16) -> u8 {
        let clamped_diff = score_diff.clamp(-40, 40);
        let bucket = (time_bucket as f64).min(96.0);

        // End of regulation -- deterministic.
        if bucket >= 96.0 {
            return if clamped_diff > 0 {
                100
            } else if clamped_diff < 0 {
                0
            } else {
                57 // tied -> OT, slight home edge
            };
        }

        let adjusted_diff = clamped_diff as f64 + self.home_advantage;
        // k ramps cubically from k_start (game start) to k_start+k_range (end of regulation).
        let k = self.k_start + (bucket / 96.0).powi(3) * self.k_range;
        let prob = 1.0 / (1.0 + (-k * adjusted_diff).exp());
        (prob * 100.0).round().clamp(0.0, 100.0) as u8
    }

    /// Overtime lookup.
    ///
    /// * `score_diff` -- home score minus away score (clamped to -40..=40).
    /// * `time_bucket` -- 0 = OT start, 10 = end of OT period (each bucket
    ///   = 30 seconds).
    ///
    /// Returns a probability 0-100 (u8).
    pub fn lookup_overtime(&self, score_diff: i32, time_bucket: u16) -> u8 {
        let clamped_diff = score_diff.clamp(-40, 40);
        let bucket = (time_bucket as f64).min(10.0);

        if bucket >= 10.0 {
            return if clamped_diff > 0 {
                100
            } else if clamped_diff < 0 {
                0
            } else {
                57
            };
        }

        let adjusted_diff = clamped_diff as f64 + self.home_advantage;
        // OT k ramps from ot_k_start to ot_k_start+ot_k_range over 5 minutes (10 buckets).
        let k = self.ot_k_start + (bucket / 10.0).powi(3) * self.ot_k_range;
        let prob = 1.0 / (1.0 + (-k * adjusted_diff).exp());
        (prob * 100.0).round().clamp(0.0, 100.0) as u8
    }

    /// Convert a live score + elapsed seconds into (home_fair, away_fair) in cents.
    /// Both values sum to 100.
    pub fn fair_value(&self, score_diff: i32, total_elapsed_seconds: u16) -> (u32, u32) {
        let time_bucket = total_elapsed_seconds / 30;
        let home = self.lookup(score_diff, time_bucket) as u32;
        (home, 100 - home)
    }

    /// Same but for overtime periods.
    /// `ot_elapsed_seconds` = seconds elapsed within the current OT period.
    pub fn fair_value_overtime(&self, score_diff: i32, ot_elapsed_seconds: u16) -> (u32, u32) {
        let time_bucket = ot_elapsed_seconds / 30;
        let home = self.lookup_overtime(score_diff, time_bucket) as u32;
        (home, 100 - home)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_table() -> WinProbTable {
        WinProbTable::new(2.5, 0.065, 0.25, 0.10, 1.0)
    }

    #[test]
    fn test_lookup_tied_game_start() {
        let prob = default_table().lookup(0, 0);
        assert!(prob >= 52 && prob <= 57, "got {prob}");
    }

    #[test]
    fn test_lookup_home_up_10_late() {
        let prob = default_table().lookup(10, 92);
        assert!(prob >= 95, "got {prob}");
    }

    #[test]
    fn test_lookup_away_up_10_late() {
        // With calibrated k, trailing by 10 with 4 min left is ~12 % in real
        // NBA data, not <5 %.  The old bound was an artifact of an over-steep k.
        let prob = default_table().lookup(-10, 92);
        assert!(prob <= 15, "got {prob}");
    }

    #[test]
    fn test_lookup_symmetry() {
        // With home-court advantage of 2.5 pts the logistic is centred at
        // adjusted_diff = 0, i.e. score_diff = -2.5.  True symmetry is:
        //   lookup(d, t) + lookup(-(d + 2*HA), t) ≈ 100
        // Using d = 2, HA = 2.5 => check lookup(2, 48) + lookup(-7, 48) ≈ 100
        let pos = default_table().lookup(2, 48);
        let neg = default_table().lookup(-7, 48);
        assert!(
            (pos + neg).abs_diff(100) <= 1,
            "pos={pos}, neg={neg}, sum={}",
            pos + neg
        );
    }

    #[test]
    fn test_lookup_clamps_extreme_diff() {
        // A 40-point lead at halftime (clamped from 50) is near-certain but
        // need not round to exactly 100 with a calibrated k.
        let prob = default_table().lookup(50, 48);
        assert!(prob >= 97, "got {prob}");
        let prob = default_table().lookup(-50, 48);
        assert!(prob <= 3, "got {prob}");
    }

    #[test]
    fn test_lookup_end_of_game_positive() {
        let prob = default_table().lookup(5, 96);
        assert_eq!(prob, 100);
    }

    #[test]
    fn test_lookup_end_of_game_behind() {
        let prob = default_table().lookup(-5, 96);
        assert_eq!(prob, 0);
    }

    #[test]
    fn test_lookup_overtime() {
        let prob = default_table().lookup_overtime(0, 0);
        assert!(prob >= 50 && prob <= 60, "got {prob}");
    }

    #[test]
    fn test_lookup_overtime_ahead() {
        let prob = default_table().lookup_overtime(3, 8);
        assert!(prob >= 90, "got {prob}");
    }

    // ---- Mid-game calibration (NBA data-driven) ----

    #[test]
    fn test_lookup_home_up_5_halftime() {
        let prob = default_table().lookup(5, 48);
        assert!(prob >= 64 && prob <= 72, "got {prob}");
    }

    #[test]
    fn test_lookup_home_up_10_halftime() {
        let prob = default_table().lookup(10, 48);
        assert!(prob >= 74 && prob <= 82, "got {prob}");
    }

    #[test]
    fn test_lookup_home_up_5_end_q3() {
        let prob = default_table().lookup(5, 72);
        assert!(prob >= 75 && prob <= 83, "got {prob}");
    }

    #[test]
    fn test_overtime_bucket4_up3() {
        // 3 min into OT with a 3-point lead should be ~73-82 %, not >90 %.
        let prob = default_table().lookup_overtime(3, 4);
        assert!(prob >= 68 && prob <= 78, "got {prob}");
    }

    // ---- Fair value bridge functions ----

    #[test]
    fn test_fair_value_from_score() {
        let (home, away) = default_table().fair_value(5, 2160);
        assert!(home > 50);
        assert_eq!(home + away, 100);
    }

    #[test]
    fn test_fair_value_from_score_overtime() {
        let (home, away) = default_table().fair_value_overtime(0, 120);
        // At OT bucket 4 (120s/30), tied game with home-court advantage => ~62%
        assert!(home >= 55 && home <= 63, "got {home}");
        assert_eq!(home + away, 100);
    }

    #[test]
    fn test_fair_value_pregame() {
        let (home, away) = default_table().fair_value(0, 0);
        assert!(home >= 52 && home <= 57);
        assert_eq!(home + away, 100);
    }
}
