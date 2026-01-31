# Market Matching & Upcoming Games Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two bugs: (1) "No upcoming games" displaying when games exist, (2) NBA/NHL/EPL teams failing to match Kalshi markets due to normalization collisions.

**Architecture:** Add per-sport team name → Kalshi ticker code lookup tables in `matcher.rs`, falling back to existing suffix-stripping for unrecognized teams (college, MMA). Fix cached commence time accounting in the engine loop when sport polls are skipped.

**Tech Stack:** Rust, chrono, no new dependencies.

---

### Task 1: Add per-sport team code lookup functions

**Files:**
- Modify: `kalshi-arb/src/engine/matcher.rs:49-109`

**Step 1: Write failing tests for team code lookups**

Add these tests at the bottom of the existing `mod tests` block in `kalshi-arb/src/engine/matcher.rs` (before the closing `}`):

```rust
    #[test]
    fn test_team_code_nba_full_names() {
        assert_eq!(team_code("basketball", "Los Angeles Lakers"), Some("LAL"));
        assert_eq!(team_code("basketball", "Los Angeles Clippers"), Some("LAC"));
        assert_eq!(team_code("basketball", "Portland Trail Blazers"), Some("POR"));
        assert_eq!(team_code("basketball", "Golden State Warriors"), Some("GSW"));
        assert_eq!(team_code("basketball", "New York Knicks"), Some("NYK"));
        assert_eq!(team_code("basketball", "Brooklyn Nets"), Some("BKN"));
        assert_eq!(team_code("basketball", "Oklahoma City Thunder"), Some("OKC"));
        assert_eq!(team_code("basketball", "New Orleans Pelicans"), Some("NOP"));
    }

    #[test]
    fn test_team_code_nba_kalshi_abbreviated() {
        assert_eq!(team_code("basketball", "Los Angeles L"), Some("LAL"));
        assert_eq!(team_code("basketball", "Los Angeles C"), Some("LAC"));
        assert_eq!(team_code("basketball", "Portland"), Some("POR"));
        assert_eq!(team_code("basketball", "Golden State"), Some("GSW"));
        assert_eq!(team_code("basketball", "New York"), Some("NYK"));
        assert_eq!(team_code("basketball", "New Orleans"), Some("NOP"));
        assert_eq!(team_code("basketball", "Oklahoma City"), Some("OKC"));
    }

    #[test]
    fn test_team_code_nhl_disambiguation() {
        assert_eq!(team_code("ice-hockey", "New York Rangers"), Some("NYR"));
        assert_eq!(team_code("ice-hockey", "New York Islanders"), Some("NYI"));
        assert_eq!(team_code("ice-hockey", "New York R"), Some("NYR"));
        assert_eq!(team_code("ice-hockey", "New York I"), Some("NYI"));
        assert_eq!(team_code("ice-hockey", "Los Angeles Kings"), Some("LA"));
        assert_eq!(team_code("ice-hockey", "Los Angeles"), Some("LA"));
        assert_eq!(team_code("ice-hockey", "Washington Capitals"), Some("WSH"));
    }

    #[test]
    fn test_team_code_epl() {
        assert_eq!(team_code("soccer-epl", "Tottenham Hotspur"), Some("TOT"));
        assert_eq!(team_code("soccer-epl", "Tottenham"), Some("TOT"));
        assert_eq!(team_code("soccer-epl", "Manchester United"), Some("MUN"));
        assert_eq!(team_code("soccer-epl", "Manchester City"), Some("MCI"));
        assert_eq!(team_code("soccer-epl", "Nottingham Forest"), Some("NFO"));
        assert_eq!(team_code("soccer-epl", "Nottingham"), Some("NFO"));
    }

    #[test]
    fn test_team_code_fallback_unknown() {
        // Unknown sport or team falls back to None
        assert_eq!(team_code("basketball", "Nonexistent Team"), None);
        assert_eq!(team_code("unknown-sport", "Boston Celtics"), None);
        // College basketball has no lookup table — returns None
        assert_eq!(team_code("college-basketball", "Duke Blue Devils"), None);
    }
```

**Step 2: Run tests to verify they fail**

Run: `cd kalshi-arb && cargo test --lib engine::matcher::tests -- --nocapture 2>&1 | tail -20`
Expected: FAIL — `team_code` function not found.

**Step 3: Implement `team_code` and per-sport lookup functions**

Add these functions in `kalshi-arb/src/engine/matcher.rs` right before the existing `normalize_team` function (before line 47):

```rust
/// Look up a team's canonical Kalshi ticker code by sport and name.
/// Returns None if the team/sport isn't in the lookup tables (falls back to suffix-stripping).
fn team_code(sport: &str, name: &str) -> Option<&'static str> {
    let upper = name.to_uppercase();
    let upper = upper.trim();
    let sport_norm: String = sport.to_uppercase().chars()
        .filter(|c| c.is_ascii_alphabetic())
        .collect();
    match sport_norm.as_str() {
        "BASKETBALL" => nba_team_code(upper),
        "ICEHOCKEY" => nhl_team_code(upper),
        "SOCCEREPL" => epl_team_code(upper),
        _ => None,
    }
}

fn nba_team_code(name: String) -> Option<&'static str> {
    match name.as_str() {
        // Atlanta Hawks
        "ATLANTA HAWKS" | "ATLANTA" => Some("ATL"),
        // Boston Celtics
        "BOSTON CELTICS" | "BOSTON" => Some("BOS"),
        // Brooklyn Nets
        "BROOKLYN NETS" | "BROOKLYN" => Some("BKN"),
        // Charlotte Hornets
        "CHARLOTTE HORNETS" | "CHARLOTTE" => Some("CHA"),
        // Chicago Bulls
        "CHICAGO BULLS" | "CHICAGO" => Some("CHI"),
        // Cleveland Cavaliers
        "CLEVELAND CAVALIERS" | "CLEVELAND" => Some("CLE"),
        // Dallas Mavericks
        "DALLAS MAVERICKS" | "DALLAS" => Some("DAL"),
        // Denver Nuggets
        "DENVER NUGGETS" | "DENVER" => Some("DEN"),
        // Detroit Pistons
        "DETROIT PISTONS" | "DETROIT" => Some("DET"),
        // Golden State Warriors
        "GOLDEN STATE WARRIORS" | "GOLDEN STATE" => Some("GSW"),
        // Houston Rockets
        "HOUSTON ROCKETS" | "HOUSTON" => Some("HOU"),
        // Indiana Pacers
        "INDIANA PACERS" | "INDIANA" => Some("IND"),
        // Los Angeles Clippers — disambiguated
        "LOS ANGELES CLIPPERS" | "LOS ANGELES C" | "LA CLIPPERS" => Some("LAC"),
        // Los Angeles Lakers — disambiguated
        "LOS ANGELES LAKERS" | "LOS ANGELES L" | "LA LAKERS" => Some("LAL"),
        // Memphis Grizzlies
        "MEMPHIS GRIZZLIES" | "MEMPHIS" => Some("MEM"),
        // Miami Heat
        "MIAMI HEAT" | "MIAMI" => Some("MIA"),
        // Milwaukee Bucks
        "MILWAUKEE BUCKS" | "MILWAUKEE" => Some("MIL"),
        // Minnesota Timberwolves
        "MINNESOTA TIMBERWOLVES" | "MINNESOTA" => Some("MIN"),
        // New Orleans Pelicans
        "NEW ORLEANS PELICANS" | "NEW ORLEANS" => Some("NOP"),
        // New York Knicks — only NBA team called "New York" on Kalshi
        "NEW YORK KNICKS" | "NEW YORK" => Some("NYK"),
        // Oklahoma City Thunder
        "OKLAHOMA CITY THUNDER" | "OKLAHOMA CITY" => Some("OKC"),
        // Orlando Magic
        "ORLANDO MAGIC" | "ORLANDO" => Some("ORL"),
        // Philadelphia 76ers
        "PHILADELPHIA 76ERS" | "PHILADELPHIA SIXERS" | "PHILADELPHIA" => Some("PHI"),
        // Phoenix Suns
        "PHOENIX SUNS" | "PHOENIX" => Some("PHX"),
        // Portland Trail Blazers
        "PORTLAND TRAIL BLAZERS" | "PORTLAND" => Some("POR"),
        // Sacramento Kings
        "SACRAMENTO KINGS" | "SACRAMENTO" => Some("SAC"),
        // San Antonio Spurs
        "SAN ANTONIO SPURS" | "SAN ANTONIO" => Some("SAS"),
        // Toronto Raptors
        "TORONTO RAPTORS" | "TORONTO" => Some("TOR"),
        // Utah Jazz
        "UTAH JAZZ" | "UTAH" => Some("UTA"),
        // Washington Wizards
        "WASHINGTON WIZARDS" | "WASHINGTON" => Some("WAS"),
        _ => None,
    }
}

fn nhl_team_code(name: String) -> Option<&'static str> {
    match name.as_str() {
        "ANAHEIM DUCKS" | "ANAHEIM" => Some("ANA"),
        "ARIZONA COYOTES" | "ARIZONA" => Some("ARI"),
        "BOSTON BRUINS" => Some("BOS"),
        "BUFFALO SABRES" | "BUFFALO" => Some("BUF"),
        "CALGARY FLAMES" | "CALGARY" => Some("CGY"),
        "CAROLINA HURRICANES" | "CAROLINA" => Some("CAR"),
        "CHICAGO BLACKHAWKS" => Some("CHI"),
        "COLORADO AVALANCHE" | "COLORADO" => Some("COL"),
        "COLUMBUS BLUE JACKETS" | "COLUMBUS" => Some("CBJ"),
        "DALLAS STARS" => Some("DAL"),
        "DETROIT RED WINGS" => Some("DET"),
        "EDMONTON OILERS" | "EDMONTON" => Some("EDM"),
        "FLORIDA PANTHERS" | "FLORIDA" => Some("FLA"),
        // Los Angeles Kings — only NHL team in LA
        "LOS ANGELES KINGS" | "LOS ANGELES" | "LA KINGS" => Some("LA"),
        "MINNESOTA WILD" => Some("MIN"),
        "MONTREAL CANADIENS" | "MONTREAL" => Some("MTL"),
        "NASHVILLE PREDATORS" | "NASHVILLE" => Some("NSH"),
        // New Jersey Devils
        "NEW JERSEY DEVILS" | "NEW JERSEY" => Some("NJ"),
        // New York Islanders — disambiguated
        "NEW YORK ISLANDERS" | "NEW YORK I" | "NY ISLANDERS" => Some("NYI"),
        // New York Rangers — disambiguated
        "NEW YORK RANGERS" | "NEW YORK R" | "NY RANGERS" => Some("NYR"),
        "OTTAWA SENATORS" | "OTTAWA" => Some("OTT"),
        "PHILADELPHIA FLYERS" => Some("PHI"),
        "PITTSBURGH PENGUINS" | "PITTSBURGH" => Some("PIT"),
        "SAN JOSE SHARKS" | "SAN JOSE" => Some("SJ"),
        "SEATTLE KRAKEN" | "SEATTLE" => Some("SEA"),
        "ST LOUIS BLUES" | "ST. LOUIS BLUES" | "ST LOUIS" | "ST. LOUIS" => Some("STL"),
        "TAMPA BAY LIGHTNING" | "TAMPA BAY" => Some("TB"),
        "TORONTO MAPLE LEAFS" => Some("TOR"),
        "UTAH HOCKEY CLUB" => Some("UTA"),
        "VANCOUVER CANUCKS" | "VANCOUVER" => Some("VAN"),
        "VEGAS GOLDEN KNIGHTS" | "VEGAS" => Some("VGK"),
        "WASHINGTON CAPITALS" | "WASHINGTON" => Some("WSH"),
        "WINNIPEG JETS" | "WINNIPEG" => Some("WPG"),
        _ => None,
    }
}

fn epl_team_code(name: String) -> Option<&'static str> {
    match name.as_str() {
        "ARSENAL" => Some("ARS"),
        "ASTON VILLA" => Some("AVL"),
        "AFC BOURNEMOUTH" | "BOURNEMOUTH" => Some("BOU"),
        "BRENTFORD" => Some("BRE"),
        "BRIGHTON AND HOVE ALBION" | "BRIGHTON" => Some("BHA"),
        "BURNLEY" => Some("BUR"),
        "CHELSEA" => Some("CHE"),
        "CRYSTAL PALACE" => Some("CRY"),
        "EVERTON" => Some("EVE"),
        "FULHAM" => Some("FUL"),
        "IPSWICH TOWN" | "IPSWICH" => Some("IPS"),
        "LEEDS UNITED" => Some("LEE"),
        "LEICESTER CITY" | "LEICESTER" => Some("LEI"),
        "LIVERPOOL" => Some("LIV"),
        "MANCHESTER CITY" => Some("MCI"),
        "MANCHESTER UNITED" => Some("MUN"),
        "NEWCASTLE UNITED" | "NEWCASTLE" => Some("NEW"),
        "NOTTINGHAM FOREST" | "NOTTINGHAM" => Some("NFO"),
        "SUNDERLAND" => Some("SUN"),
        "TOTTENHAM HOTSPUR" | "TOTTENHAM" => Some("TOT"),
        "WEST HAM UNITED" | "WEST HAM" => Some("WHU"),
        "WOLVERHAMPTON WANDERERS" | "WOLVERHAMPTON" | "WOLVES" => Some("WOL"),
        _ => None,
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd kalshi-arb && cargo test --lib engine::matcher::tests -- --nocapture 2>&1 | tail -20`
Expected: All `test_team_code_*` tests PASS. Existing tests may fail (next task fixes them).

**Step 5: Commit**

```bash
git add kalshi-arb/src/engine/matcher.rs
git commit -m "feat: add per-sport team code lookup tables for NBA, NHL, EPL"
```

---

### Task 2: Wire team_code into normalize_team and generate_key

**Files:**
- Modify: `kalshi-arb/src/engine/matcher.rs:49-125` (normalize_team + generate_key)

**Step 1: Write failing test for cross-source matching**

Add this test to the `mod tests` block — it verifies the core bug fix (Odds API name matches Kalshi abbreviated name):

```rust
    #[test]
    fn test_normalize_team_cross_source_matching() {
        // Odds API full name and Kalshi abbreviated name must produce same output
        let sport = "basketball";
        assert_eq!(normalize_team(sport, "Los Angeles Lakers"), normalize_team(sport, "Los Angeles L"));
        assert_eq!(normalize_team(sport, "Los Angeles Clippers"), normalize_team(sport, "Los Angeles C"));
        assert_eq!(normalize_team(sport, "Portland Trail Blazers"), normalize_team(sport, "Portland"));

        // NHL disambiguation
        let sport = "ice-hockey";
        assert_eq!(normalize_team(sport, "New York Rangers"), normalize_team(sport, "New York R"));
        assert_eq!(normalize_team(sport, "New York Islanders"), normalize_team(sport, "New York I"));
        // NHL Rangers != Islanders
        assert_ne!(normalize_team(sport, "New York Rangers"), normalize_team(sport, "New York Islanders"));
    }

    #[test]
    fn test_generate_key_cross_source() {
        let d = NaiveDate::from_ymd_opt(2026, 1, 30).unwrap();
        // Odds API: "Los Angeles Lakers" vs Kalshi title: "Los Angeles L" — must produce same key
        let k_odds = generate_key("basketball", "Los Angeles Lakers", "Washington Wizards", d).unwrap();
        let k_kalshi = generate_key("basketball", "Los Angeles L", "Washington", d).unwrap();
        assert_eq!(k_odds, k_kalshi);

        // Lakers and Clippers must NOT collide
        let k_lakers = generate_key("basketball", "Los Angeles Lakers", "Washington Wizards", d).unwrap();
        let k_clippers = generate_key("basketball", "Los Angeles Clippers", "Denver Nuggets", d).unwrap();
        assert_ne!(k_lakers, k_clippers);
    }
```

**Step 2: Run tests to verify they fail**

Run: `cd kalshi-arb && cargo test --lib engine::matcher::tests::test_normalize_team_cross -- --nocapture 2>&1 | tail -10`
Expected: FAIL — `normalize_team` still takes 1 argument.

**Step 3: Update normalize_team signature and wire in team_code**

Replace the `normalize_team` function signature and add the lookup at the top of the body. The existing suffix-stripping logic becomes the fallback. Change line 49 onward:

**Old (line 47-109):**
```rust
/// Normalizes a team name by stripping mascots and keeping location.
/// Matches the JS dashboard logic: suffix must be at end preceded by whitespace.
pub fn normalize_team(name: &str) -> String {
```

**New:**
```rust
/// Normalizes a team name to a canonical key for market matching.
/// First checks per-sport lookup tables (NBA, NHL, EPL) for exact team codes.
/// Falls back to suffix-stripping for sports without lookup tables (college, MMA).
pub fn normalize_team(sport: &str, name: &str) -> String {
    // Try per-sport lookup first
    if let Some(code) = team_code(sport, name) {
        return code.to_string();
    }

    // Fallback: suffix-stripping normalization (college, MMA, unknown teams)
```

Everything else in the function body stays exactly the same.

**Step 4: Update generate_key to pass sport**

Change lines 112-114:

**Old:**
```rust
pub fn generate_key(sport: &str, team1: &str, team2: &str, date: NaiveDate) -> Option<MarketKey> {
    let n1 = normalize_team(team1);
    let n2 = normalize_team(team2);
```

**New:**
```rust
pub fn generate_key(sport: &str, team1: &str, team2: &str, date: NaiveDate) -> Option<MarketKey> {
    let n1 = normalize_team(sport, team1);
    let n2 = normalize_team(sport, team2);
```

**Step 5: Update existing tests for new signature**

The existing `test_normalize_team` test calls `normalize_team` with 1 arg. Update it:

**Old:**
```rust
    #[test]
    fn test_normalize_team() {
        assert_eq!(normalize_team("Dallas Mavericks"), "DALLAS");
        assert_eq!(normalize_team("Los Angeles Lakers"), "LOSANGELES");
        assert_eq!(normalize_team("New York Knicks"), "NEWYORK");
        assert_eq!(normalize_team("Oklahoma City Thunder"), "OKLAHOMACITY");
    }
```

**New:**
```rust
    #[test]
    fn test_normalize_team() {
        // With lookup tables, NBA teams return ticker codes
        assert_eq!(normalize_team("basketball", "Dallas Mavericks"), "DAL");
        assert_eq!(normalize_team("basketball", "Los Angeles Lakers"), "LAL");
        assert_eq!(normalize_team("basketball", "New York Knicks"), "NYK");
        assert_eq!(normalize_team("basketball", "Oklahoma City Thunder"), "OKC");
    }
```

Also update `test_generate_key_sorted` to use recognizable team names:

**Old:**
```rust
    #[test]
    fn test_generate_key_sorted() {
        let d = NaiveDate::from_ymd_opt(2026, 1, 19).unwrap();
        let k1 = generate_key("NBA", "Lakers", "Celtics", d).unwrap();
        let k2 = generate_key("NBA", "Celtics", "Lakers", d).unwrap();
        assert_eq!(k1, k2); // same regardless of order
    }
```

**New:**
```rust
    #[test]
    fn test_generate_key_sorted() {
        let d = NaiveDate::from_ymd_opt(2026, 1, 19).unwrap();
        // Full team names, sport key as used by engine
        let k1 = generate_key("basketball", "Los Angeles Lakers", "Boston Celtics", d).unwrap();
        let k2 = generate_key("basketball", "Boston Celtics", "Los Angeles Lakers", d).unwrap();
        assert_eq!(k1, k2); // same regardless of order
    }
```

**Step 6: Run all matcher tests**

Run: `cd kalshi-arb && cargo test --lib engine::matcher::tests -- --nocapture 2>&1`
Expected: All tests PASS.

**Step 7: Commit**

```bash
git add kalshi-arb/src/engine/matcher.rs
git commit -m "feat: wire team code lookups into normalize_team with suffix-strip fallback"
```

---

### Task 3: Fix "No upcoming games" bug in main.rs

**Files:**
- Modify: `kalshi-arb/src/main.rs:484-489`

**Step 1: Apply the cached commence time fix**

Replace lines 484-489 in `kalshi-arb/src/main.rs`:

**Old:**
```rust
                // Skip if not enough time has passed since last poll for this sport
                if let Some(&last) = last_poll.get(sport.as_str()) {
                    if cycle_start.duration_since(last) < interval {
                        continue;
                    }
                }
```

**New:**
```rust
                // Skip if not enough time has passed since last poll for this sport
                if let Some(&last) = last_poll.get(sport.as_str()) {
                    if cycle_start.duration_since(last) < interval {
                        // Still account for cached upcoming games from previous poll
                        if let Some(times) = sport_commence_times.get(sport.as_str()) {
                            let now_utc = chrono::Utc::now();
                            for ct_str in times {
                                if let Ok(ct) = chrono::DateTime::parse_from_rfc3339(ct_str) {
                                    let ct_utc = ct.with_timezone(&chrono::Utc);
                                    if ct_utc > now_utc {
                                        filter_pre_game += 1;
                                        earliest_commence = Some(match earliest_commence {
                                            Some(existing) => existing.min(ct_utc),
                                            None => ct_utc,
                                        });
                                    }
                                }
                            }
                        }
                        continue;
                    }
                }
```

**Step 2: Verify it compiles**

Run: `cd kalshi-arb && cargo check 2>&1 | tail -10`
Expected: No errors. (This logic is in an async runtime loop and isn't unit-testable without integration setup; compilation + manual verification is the test strategy.)

**Step 3: Commit**

```bash
git add kalshi-arb/src/main.rs
git commit -m "fix: account for cached commence times when sport poll is skipped"
```

---

### Task 4: Full build and test verification

**Step 1: Run the full test suite**

Run: `cd kalshi-arb && cargo test 2>&1`
Expected: All tests pass, no warnings.

**Step 2: Run clippy for lint check**

Run: `cd kalshi-arb && cargo clippy 2>&1 | tail -20`
Expected: No errors. Fix any warnings if they appear.

**Step 3: Final commit (if clippy fixes needed)**

```bash
git add kalshi-arb/src/
git commit -m "fix: address clippy warnings"
```
