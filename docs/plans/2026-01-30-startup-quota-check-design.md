# Startup API Quota Check

## Problem

The TUI status bar shows `0/0 used` until the first Odds API poll completes (up to 20-120 seconds after launch). There is also no early validation that the API key is valid or has remaining quota.

## Solution

Call the free `/v4/sports` endpoint at startup to fetch quota headers without consuming usage credits. Validate the key and update the TUI state before entering the main loop.

## Changes

### 1. Add `check_quota()` to `TheOddsApi` (feed/the_odds_api.rs)

New public method on the concrete struct (not the `OddsFeed` trait):

- GET `{base_url}/v4/sports?apiKey={api_key}`
- Parse `x-requests-used` and `x-requests-remaining` from response headers
- Store in `self.last_quota`
- Return `Result<ApiQuota>`
- On HTTP error (401/403): return error "Invalid API key"
- On remaining == 0: return error "API quota exhausted"

### 2. Call at startup in `main.rs`

After constructing `TheOddsApi`, before spawning the engine task:

- Call `odds_feed.check_quota().await`
- On success: `state_tx.send_modify()` with quota values, burn_rate=0, hours_remaining=infinity
- On error: `eprintln!` the error and `process::exit(1)`

This runs before the TUI starts, so simple stderr output is appropriate.

## No other changes needed

The existing code already handles quota updates after every API call and renders them in the status bar.
