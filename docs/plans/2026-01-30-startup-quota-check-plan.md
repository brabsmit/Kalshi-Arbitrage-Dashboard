# Startup API Quota Check - Implementation Plan

## Step 1: Add `check_quota()` method to `TheOddsApi`

File: `kalshi-arb/src/feed/the_odds_api.rs`

Add a public async method `check_quota(&mut self) -> Result<ApiQuota>` that:
- Calls GET `{base_url}/v4/sports?apiKey={api_key}`
- Checks HTTP status: bail on non-success with descriptive message
- Parses `x-requests-used` and `x-requests-remaining` headers
- Stores in `self.last_quota`
- Bails if remaining == 0 ("API quota exhausted")
- Returns the `ApiQuota`

## Step 2: Call at startup in `main.rs`

File: `kalshi-arb/src/main.rs`

After `odds_feed` is constructed, before the engine `tokio::spawn`:
- Call `odds_feed.check_quota().await`
- On `Ok(quota)`: update state via `state_tx.send_modify()` with used, remaining, burn_rate=0.0, hours_remaining=f64::INFINITY
- On `Err(e)`: `eprintln!` and `std::process::exit(1)`

## Verification

- `cargo clippy` passes
- `cargo test` passes
- Run app with valid key: status bar shows correct quota from first frame
- Confirm quota total is 20,000 for the .env key
