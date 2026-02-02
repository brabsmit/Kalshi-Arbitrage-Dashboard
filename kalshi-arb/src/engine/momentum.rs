use std::collections::VecDeque;
use std::time::Instant;

/// A single timestamped odds snapshot for one event.
#[derive(Debug, Clone)]
pub struct OddsSnapshot {
    pub implied_prob: f64,
    pub timestamp: Instant,
}

/// Tracks sportsbook odds velocity for a single event.
#[derive(Debug)]
pub struct VelocityTracker {
    snapshots: VecDeque<OddsSnapshot>,
    window_size: usize,
}

impl VelocityTracker {
    pub fn new(window_size: usize) -> Self {
        Self {
            snapshots: VecDeque::with_capacity(window_size),
            window_size,
        }
    }

    /// Push a new odds snapshot. If implied_prob is identical to the previous
    /// snapshot, it's a stale cache hit -- skip it (don't store).
    /// Returns true if the snapshot was stored (i.e., it was a genuine update).
    pub fn push(&mut self, implied_prob: f64, timestamp: Instant) -> bool {
        // Skip stale duplicates
        if let Some(last) = self.snapshots.back() {
            if (last.implied_prob - implied_prob).abs() < 1e-9 {
                return false;
            }
        }
        if self.snapshots.len() >= self.window_size {
            self.snapshots.pop_front();
        }
        self.snapshots.push_back(OddsSnapshot {
            implied_prob,
            timestamp,
        });
        true
    }

    /// Compute velocity score (0-100).
    ///
    /// Velocity = |delta_prob| / delta_time (percentage points per minute).
    /// Uses the oldest and newest non-stale snapshots in the window.
    /// Normalization: 10 points/min -> score 100 (configurable via MAX_VELOCITY).
    ///
    /// Returns 0 if fewer than 2 snapshots exist.
    pub fn score(&self) -> f64 {
        if self.snapshots.len() < 2 {
            return 0.0;
        }
        let oldest = match self.snapshots.front() {
            Some(s) => s,
            None => return 0.0, // Empty queue = no velocity
        };
        let newest = match self.snapshots.back() {
            Some(s) => s,
            None => return 0.0,
        };
        let dt_secs = newest
            .timestamp
            .duration_since(oldest.timestamp)
            .as_secs_f64();
        if dt_secs < 0.001 {
            return 0.0;
        }
        // Delta in percentage points (e.g., 0.60 -> 0.64 = 4.0 pp)
        let delta_pp = (newest.implied_prob - oldest.implied_prob).abs() * 100.0;
        let velocity_per_min = delta_pp / (dt_secs / 60.0);

        // Normalize: 10 pp/min = score 100
        const MAX_VELOCITY: f64 = 10.0;
        (velocity_per_min / MAX_VELOCITY * 100.0).min(100.0)
    }
}

/// Tracks orderbook depth pressure for a single market.
///
/// Computes bid/ask pressure ratio near the touch and tracks its rate of change.
#[derive(Debug)]
pub struct BookPressureTracker {
    /// Recent pressure ratios (bid_depth / ask_depth near touch)
    ratios: VecDeque<(f64, Instant)>,
    window_size: usize,
}

impl BookPressureTracker {
    pub fn new(window_size: usize) -> Self {
        Self {
            ratios: VecDeque::with_capacity(window_size),
            window_size,
        }
    }

    /// Record a new pressure observation.
    ///
    /// `bid_depth`: total quantity on bid side within band of best bid.
    /// `ask_depth`: total quantity on ask side within band of best ask.
    pub fn push(&mut self, bid_depth: u64, ask_depth: u64, timestamp: Instant) {
        let ratio = if ask_depth == 0 {
            if bid_depth > 0 {
                10.0
            } else {
                1.0
            } // Cap at 10x when ask is empty
        } else {
            bid_depth as f64 / ask_depth as f64
        };
        if self.ratios.len() >= self.window_size {
            self.ratios.pop_front();
        }
        self.ratios.push_back((ratio, timestamp));
    }

    /// Compute pressure score (0-100).
    ///
    /// Based on two factors:
    /// 1. Current ratio level (ratio > 1 means more bid pressure)
    /// 2. Rate of change of ratio (increasing ratio = building momentum)
    ///
    /// Normalization: ratio of 3.0 with increasing trend -> score ~100.
    pub fn score(&self) -> f64 {
        if self.ratios.is_empty() {
            return 0.0;
        }

        let (current_ratio, _) = *self.ratios.back().unwrap();

        // Level component: ratio 1.0 = neutral (0), ratio 3.0+ = max (50)
        let level_score = ((current_ratio - 1.0).max(0.0) / 2.0 * 50.0).min(50.0);

        // Trend component: rate of change of ratio
        let trend_score = if self.ratios.len() >= 2 {
            let (oldest_ratio, oldest_t) = *self.ratios.front().unwrap();
            let (newest_ratio, newest_t) = *self.ratios.back().unwrap();
            let dt = newest_t.duration_since(oldest_t).as_secs_f64();
            if dt > 0.001 {
                let change_per_sec = (newest_ratio - oldest_ratio) / dt;
                // Normalize: +1.0 ratio/sec = 50 points
                (change_per_sec / 1.0 * 50.0).clamp(0.0, 50.0)
            } else {
                0.0
            }
        } else {
            0.0
        };

        (level_score + trend_score).min(100.0)
    }
}

/// Combines velocity and book pressure into a composite momentum score.
pub struct MomentumScorer {
    pub velocity_weight: f64,
    pub book_pressure_weight: f64,
}

impl MomentumScorer {
    pub fn new(velocity_weight: f64, book_pressure_weight: f64) -> Self {
        Self {
            velocity_weight,
            book_pressure_weight,
        }
    }

    /// Compute composite score from sub-signal scores.
    pub fn composite(&self, velocity_score: f64, book_pressure_score: f64) -> f64 {
        let raw =
            self.velocity_weight * velocity_score + self.book_pressure_weight * book_pressure_score;
        raw.clamp(0.0, 100.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_velocity_no_snapshots() {
        let tracker = VelocityTracker::new(5);
        assert_eq!(tracker.score(), 0.0);
    }

    #[test]
    fn test_velocity_single_snapshot() {
        let mut tracker = VelocityTracker::new(5);
        tracker.push(0.60, Instant::now());
        assert_eq!(tracker.score(), 0.0);
    }

    #[test]
    fn test_velocity_stale_duplicate_skipped() {
        let mut tracker = VelocityTracker::new(5);
        let t0 = Instant::now();
        assert!(tracker.push(0.60, t0));
        assert!(!tracker.push(0.60, t0 + Duration::from_secs(20)));
        // Still only 1 snapshot stored
        assert_eq!(tracker.score(), 0.0);
    }

    #[test]
    fn test_velocity_two_snapshots() {
        let mut tracker = VelocityTracker::new(5);
        let t0 = Instant::now();
        tracker.push(0.60, t0);
        // +4.3 pp over 20 seconds = 12.9 pp/min -> clamped to 100
        tracker.push(0.643, t0 + Duration::from_secs(20));
        let score = tracker.score();
        assert!(score > 50.0, "score should be high: {}", score);
    }

    #[test]
    fn test_velocity_slow_movement() {
        let mut tracker = VelocityTracker::new(5);
        let t0 = Instant::now();
        tracker.push(0.60, t0);
        // +1 pp over 2 minutes = 0.5 pp/min -> score ~5
        tracker.push(0.61, t0 + Duration::from_secs(120));
        let score = tracker.score();
        assert!(score < 10.0, "score should be low: {}", score);
        assert!(score > 0.0, "score should be nonzero: {}", score);
    }

    #[test]
    fn test_velocity_window_eviction() {
        let mut tracker = VelocityTracker::new(3);
        let t0 = Instant::now();
        tracker.push(0.50, t0);
        tracker.push(0.55, t0 + Duration::from_secs(10));
        tracker.push(0.60, t0 + Duration::from_secs(20));
        // Window full (3), push evicts oldest
        tracker.push(0.65, t0 + Duration::from_secs(30));
        // Oldest should now be 0.55, newest 0.65
        // delta = 10pp over 20s = 30 pp/min -> clamped to 100
        let score = tracker.score();
        assert!(
            score > 90.0,
            "score should be high after eviction: {}",
            score
        );
    }

    // --- BookPressureTracker tests ---

    #[test]
    fn test_book_pressure_empty() {
        let tracker = BookPressureTracker::new(5);
        assert_eq!(tracker.score(), 0.0);
    }

    #[test]
    fn test_book_pressure_neutral() {
        let mut tracker = BookPressureTracker::new(5);
        // Equal depth = ratio 1.0 = neutral
        tracker.push(100, 100, Instant::now());
        assert_eq!(tracker.score(), 0.0);
    }

    #[test]
    fn test_book_pressure_bid_heavy() {
        let mut tracker = BookPressureTracker::new(5);
        // Ratio 3:1 = strong bid pressure
        tracker.push(300, 100, Instant::now());
        let score = tracker.score();
        assert!(score >= 45.0, "bid-heavy should score high: {}", score);
    }

    #[test]
    fn test_book_pressure_increasing_trend() {
        let mut tracker = BookPressureTracker::new(5);
        let t0 = Instant::now();
        tracker.push(100, 100, t0); // ratio 1.0
        tracker.push(200, 100, t0 + Duration::from_secs(1)); // ratio 2.0
        let score = tracker.score();
        // level: (2.0-1.0)/2.0*50 = 25, trend: 1.0/1.0*50 = 50 -> 75
        assert!(
            score > 50.0,
            "increasing trend should score high: {}",
            score
        );
    }

    #[test]
    fn test_book_pressure_ask_empty() {
        let mut tracker = BookPressureTracker::new(5);
        // Ask side is empty = very strong buy signal
        tracker.push(100, 0, Instant::now());
        let score = tracker.score();
        assert!(score > 40.0, "empty ask should score high: {}", score);
    }

    // --- MomentumScorer tests ---

    #[test]
    fn test_composite_score() {
        let scorer = MomentumScorer::new(0.6, 0.4);
        // 80 velocity, 50 pressure -> 0.6*80 + 0.4*50 = 48 + 20 = 68
        let score = scorer.composite(80.0, 50.0);
        assert!((score - 68.0).abs() < 0.01, "composite: {}", score);
    }

    #[test]
    fn test_composite_score_clamped() {
        let scorer = MomentumScorer::new(0.6, 0.4);
        let score = scorer.composite(100.0, 100.0);
        assert_eq!(score, 100.0);
    }

    #[test]
    fn test_composite_score_zero() {
        let scorer = MomentumScorer::new(0.6, 0.4);
        let score = scorer.composite(0.0, 0.0);
        assert_eq!(score, 0.0);
    }
}
