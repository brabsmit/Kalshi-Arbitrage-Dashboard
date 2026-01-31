# College Basketball Matching Improvements

## Problem

Most college basketball games (~90%) show "No match found" in the diagnostic display. The matching system normalizes team names by stripping mascot suffixes and comparing location/school names, but the college section only covers ~38 mascots out of 350+ D1 teams.

## Root Cause

1. **Incomplete suffix list** — Missing ~100 college mascots (HOKIES, WOLFPACK, BEARCATS, RED RAIDERS, KNIGHTS, GOLDEN EAGLES, BLUE DEMONS, MUSKETEERS, BOILERMAKERS, etc.)
2. **First-match-wins ordering bug** — The suffix loop breaks on the first match. Multi-word college mascots like `GOLDEN EAGLES` lose to shorter pro entries like `EAGLES` (NFL) that appear earlier in the list, producing incorrect normalizations (e.g., `MARQUETTEGOLDEN` instead of `MARQUETTE`).

## Solution

### 1. Longest-match-wins algorithm

Change the suffix stripping loop from `break` on first match to tracking the longest matching suffix. This makes ordering irrelevant and ensures `GOLDEN EAGLES` always wins over `EAGLES`.

```rust
let mut best: Option<String> = None;
let mut best_len = 0;
for suffix in &suffixes {
    if let Some(stripped) = s.strip_suffix(suffix) {
        let stripped = stripped.trim_end();
        if !stripped.is_empty() && suffix.len() > best_len {
            best = Some(stripped.to_string());
            best_len = suffix.len();
        }
    }
}
if let Some(m) = best { s = m; }
```

### 2. Expand college suffix list

Add ~100 missing D1 basketball mascots organized by tier:

**Power conferences (ACC, Big 12, Big East, Big Ten, SEC):**
WOLFPACK, HOKIES, MUSTANGS, BEARCATS, HORNED FROGS, RED RAIDERS, KNIGHTS, BLUEJAYS, BLUE DEMONS, HOYAS, GOLDEN EAGLES, FRIARS, RED STORM, MUSKETEERS, FIGHTING ILLINI, GOLDEN GOPHERS, BOILERMAKERS, REBELS, COMMODORES, OWLS

**Major mid-majors (AAC, MWC, WCC, A-10, etc.):**
AZTECS, LOBOS, SHOCKERS, MIDSHIPMEN, GREEN WAVE, GOLDEN HURRICANE, ROADRUNNERS, MEAN GREEN, GAELS, DUKES, BILLIKENS, SPIDERS, RAMBLERS, MINUTEMEN, EXPLORERS, BONNIES, WAVES, PILOTS, TOREROS, DONS, BOBCATS, PEACOCKS, CATAMOUNTS, COLONIALS, WOLF PACK

**Smaller conferences:**
TERRIERS, BISON, CRUSADERS, LEOPARDS, BLACK KNIGHTS, PHOENIX, SEAWOLVES, DRAGONS, BLUE HENS, FIGHTING CAMELS, SYCAMORES, BEACONS, MASTODONS, SALUKIS, RACERS, SKYHAWKS, LUMBERJACKS, COLONELS, CHANTICLEERS, THUNDERING HERD, REDHAWKS, MONARCHS, VANDALS, CRIMSON, QUAKERS, ANTEATERS, GAUCHOS, MOCS, PALADINS, KEYDETS, STAGS, JASPERS, RED FOXES, PURPLE EAGLES, BRONCS, GOLDEN GRIFFINS, PURPLE ACES, REDBIRDS, NORSE, GOLDEN GRIZZLIES, MOUNTAIN HAWKS, GREYHOUNDS, PRIDE, TRIBE, PIONEERS, JACKRABBITS, RED WOLVES, WARHAWKS, RAGIN CAJUNS, THUNDERBIRDS, LANCERS, ANTELOPES, GOVERNORS, OSPREYS, HATTERS, MATADORS, HIGHLANDERS, TRITONS, BIG RED, BIG GREEN, RATTLERS, DELTA DEVILS, PRIVATEERS, DEMONS, SCREAMING EAGLES, LEATHERNECKS, TRAILBLAZERS, RAINBOW WARRIORS

### 3. Add tests

Add tests for college team normalization covering:
- Power conference teams (suffix stripping works)
- Multi-word suffix priority (GOLDEN EAGLES beats EAGLES)
- Cross-source matching (Polymarket full name matches Kalshi abbreviated name)

## Files Changed

- `kalshi-arb/src/engine/matcher.rs` — algorithm fix, suffix list expansion, new tests
