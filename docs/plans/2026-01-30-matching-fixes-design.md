# Fix: Market Matching Failures & "No Upcoming Games" Display Bug

**Date:** 2026-01-30

## Problem

Two related issues in the TUI dashboard:

1. **"No upcoming games" shows when games exist.** The main view displays "No upcoming games found" even though the diagnostic view shows valid upcoming games with open Kalshi markets. This happens because `earliest_commence` is reset to `None` every loop iteration, and when a sport is skipped due to its polling timer, its upcoming games don't contribute to the counter.

2. **NBA games fail to match Kalshi markets.** Three of nine tonight's games show "No match found" despite having active Kalshi markets. The affected games share a pattern: teams from multi-team cities (LA Lakers, LA Clippers) or teams with compound mascots (Portland Trail Blazers).

### Root Cause: Issue 1

In `main.rs`, the engine loop resets `earliest_commence = None` and `filter_pre_game = 0` at the top of every iteration (line 432). When a sport is skipped because its polling interval hasn't elapsed (line 486-489), neither counter is updated. The TUI receives `next_game_start = None` and displays "No upcoming games found" instead of the countdown.

### Root Cause: Issue 2

`normalize_team()` strips mascot suffixes to produce city-only keys. But Kalshi titles use abbreviated team forms that don't match the Odds API's full names:

| Source | Input | Normalized |
|--------|-------|-----------|
| Odds API | "Los Angeles Lakers" | strips "LAKERS" → **LOSANGELES** |
| Kalshi title | "Los Angeles L" | no suffix match → **LOSANGELESL** |
| Odds API | "Portland Trail Blazers" | strips "BLAZERS" (before "TRAIL BLAZERS") → **PORTLANDTRAIL** |
| Kalshi title | "Portland" | no suffix match → **PORTLAND** |

The keys never match because Kalshi's abbreviated titles normalize differently than the Odds API's full team names.

## Fix 1: Cached Commence Times for Skipped Sports

When a sport is skipped due to its polling timer, iterate its cached commence times from `sport_commence_times` to still update `earliest_commence` and `filter_pre_game`.

**Location:** `main.rs`, after the polling interval check (~line 486).

```rust
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

## Fix 2: Per-Sport Team Code Lookup Tables

Replace the suffix-stripping normalization with per-sport lookup tables that map team name variants to Kalshi's canonical ticker codes.

### API-Confirmed Mappings

Verified against live Kalshi API (`GET /trade-api/v2/markets?series_ticker=KXNBAGAME&status=open`):

**NBA (30 teams):**

| Code | Full Name (Odds API) | Kalshi Title | Notes |
|------|---------------------|--------------|-------|
| ATL | Atlanta Hawks | Atlanta | |
| BKN | Brooklyn Nets | Brooklyn | |
| BOS | Boston Celtics | Boston | |
| CHA | Charlotte Hornets | Charlotte | |
| CHI | Chicago Bulls | Chicago | |
| CLE | Cleveland Cavaliers | Cleveland | |
| DAL | Dallas Mavericks | Dallas | |
| DEN | Denver Nuggets | Denver | |
| DET | Detroit Pistons | Detroit | |
| GSW | Golden State Warriors | Golden State | |
| HOU | Houston Rockets | Houston | |
| IND | Indiana Pacers | Indiana | |
| LAC | Los Angeles Clippers | Los Angeles C | **Disambiguation** |
| LAL | Los Angeles Lakers | Los Angeles L | **Disambiguation** |
| MEM | Memphis Grizzlies | Memphis | |
| MIA | Miami Heat | Miami | |
| MIL | Milwaukee Bucks | Milwaukee | |
| MIN | Minnesota Timberwolves | Minnesota | |
| NOP | New Orleans Pelicans | New Orleans | |
| NYK | New York Knicks | New York | **Ambiguous city** |
| OKC | Oklahoma City Thunder | Oklahoma City | |
| ORL | Orlando Magic | Orlando | |
| PHI | Philadelphia 76ers | Philadelphia | |
| PHX | Phoenix Suns | Phoenix | |
| POR | Portland Trail Blazers | Portland | **Suffix ordering bug** |
| SAC | Sacramento Kings | Sacramento | |
| SAS | San Antonio Spurs | San Antonio | |
| TOR | Toronto Raptors | Toronto | |
| UTA | Utah Jazz | Utah | |
| WAS | Washington Wizards | Washington | |

**NHL (32 teams) — confirmed from API:**

| Code | Full Name (Odds API) | Kalshi Title | Notes |
|------|---------------------|--------------|-------|
| ANA | Anaheim Ducks | Anaheim | |
| ARI | Arizona Coyotes | Arizona | |
| BOS | Boston Bruins | Boston | |
| BUF | Buffalo Sabres | Buffalo | |
| CAR | Carolina Hurricanes | Carolina | |
| CBJ | Columbus Blue Jackets | Columbus | |
| CGY | Calgary Flames | Calgary | |
| CHI | Chicago Blackhawks | Chicago | |
| COL | Colorado Avalanche | Colorado | |
| DAL | Dallas Stars | Dallas | |
| DET | Detroit Red Wings | Detroit | |
| EDM | Edmonton Oilers | Edmonton | |
| FLA | Florida Panthers | Florida | |
| LA | Los Angeles Kings | Los Angeles | **2-char code** |
| MIN | Minnesota Wild | Minnesota | |
| MTL | Montreal Canadiens | Montreal | |
| NJ | New Jersey Devils | New Jersey | **2-char code** |
| NSH | Nashville Predators | Nashville | |
| NYI | New York Islanders | New York I | **Disambiguation** |
| NYR | New York Rangers | New York R | **Disambiguation** |
| OTT | Ottawa Senators | Ottawa | |
| PHI | Philadelphia Flyers | Philadelphia | |
| PIT | Pittsburgh Penguins | Pittsburgh | |
| SEA | Seattle Kraken | Seattle | |
| SJ | San Jose Sharks | San Jose | **2-char code** |
| STL | St. Louis Blues | St. Louis | |
| TB | Tampa Bay Lightning | Tampa Bay | **2-char code** |
| TOR | Toronto Maple Leafs | Toronto | |
| UTA | Utah Hockey Club | Utah | |
| VAN | Vancouver Canucks | Vancouver | |
| VGK | Vegas Golden Knights | Vegas | |
| WPG | Winnipeg Jets | Winnipeg | |
| WSH | Washington Capitals | Washington | **WSH not WAS** |

**EPL (20 teams) — confirmed from API:**

| Code | Full Name (Odds API) | Kalshi Title |
|------|---------------------|--------------|
| ARS | Arsenal | Arsenal |
| AVL | Aston Villa | Aston Villa |
| BOU | AFC Bournemouth / Bournemouth | Bournemouth |
| BRE | Brentford | Brentford |
| BHA | Brighton and Hove Albion | Brighton |
| BUR | Burnley | Burnley |
| CHE | Chelsea | Chelsea |
| CRY | Crystal Palace | Crystal Palace |
| EVE | Everton | Everton |
| FUL | Fulham | Fulham |
| IPS | Ipswich Town | Ipswich |
| LEE | Leeds United | Leeds United |
| LEI | Leicester City | Leicester |
| LIV | Liverpool | Liverpool |
| MCI | Manchester City | Manchester City |
| MUN | Manchester United | Manchester United |
| NEW | Newcastle United | Newcastle |
| NFO | Nottingham Forest | Nottingham |
| SUN | Sunderland | Sunderland |
| TOT | Tottenham Hotspur | Tottenham |
| WHU | West Ham United | West Ham |
| WOL | Wolverhampton Wanderers | Wolverhampton |

Note: NFL and MLB tables needed when those seasons are active. MMA and college sports continue using existing normalization (MMA uses last-name matching; college has hundreds of schools).

### Implementation

**Changes to `engine/matcher.rs`:**

1. Add `normalize_team(sport: &str, name: &str) -> String` (sport parameter added).
2. New function checks per-sport lookup tables first, falls back to current suffix-stripping logic.
3. Lookup tables implemented as `match` on uppercased+trimmed input. Each sport function returns `Option<&'static str>`.
4. Each team entry includes: full name, Kalshi abbreviated form, and city-only (when unambiguous).

```rust
fn team_code(sport: &str, name: &str) -> Option<&'static str> {
    let upper = name.to_uppercase();
    let upper = upper.trim();
    let sport_upper: String = sport.to_uppercase().chars()
        .filter(|c| c.is_ascii_alphabetic()).collect();
    match sport_upper.as_str() {
        "BASKETBALL" => nba_team_code(&upper),
        "ICEHOCKEY" => nhl_team_code(&upper),
        "SOCCEREPL" => epl_team_code(&upper),
        _ => None,
    }
}
```

**Callers:** No changes needed beyond `normalize_team`'s new signature. `generate_key` already receives `sport` and passes it through. All code paths (market index building, odds matching, diagnostic rows) flow through `generate_key`.

### Scope

- `engine/matcher.rs`: lookup tables + modified `normalize_team`
- `main.rs` ~line 486: cached commence time fix
- Tests: update `test_normalize_team` for sport parameter, add tests for lookup table hits and fallback behavior
