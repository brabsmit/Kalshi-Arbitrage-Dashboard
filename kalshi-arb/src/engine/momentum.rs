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
        let oldest = self.snapshots.front().unwrap();
        let newest = self.snapshots.back().unwrap();
        let dt_secs = newest.timestamp.duration_since(oldest.timestamp).as_secs_f64();
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
        assert!(score > 90.0, "score should be high after eviction: {}", score);
    }
}
