# Project Instructions

## Pre-Push Build

Before every `git push`, build the Windows executable and copy it to `kalshi-arb/`:

```bash
cd kalshi-arb && cargo build --release --target x86_64-pc-windows-gnu && cp target/x86_64-pc-windows-gnu/release/kalshi-arb.exe kalshi-arb.exe
```

Commit the updated `kalshi-arb/kalshi-arb.exe` if it changed.

## NCAAB Data Flow Reference

Review and keep up to date: `kalshi-arb/NCAAB_DATA_FLOW_ANALYSIS.md`

This document maps the complete pipeline from real-world NCAAB data to maker/taker trading actions, including latencies at each step, fair value models, and NCAAB-specific parameters. When modifying any component in the pipeline (feeds, fair value, matching, strategy, fees, execution), update the analysis file to reflect the changes.

## Pre-Live Trading Checklist

Before enabling live trading (setting `simulation.enabled = false`):

- [ ] Run full test suite: `cd kalshi-arb && cargo test`
- [ ] Test dry-run mode thoroughly with current markets
- [ ] Verify RiskManager limits in config.toml are appropriate
- [ ] Confirm position reconciliation on startup works
- [ ] Test kill switch (F12) in dry-run mode
- [ ] Review all logs for unwrap/panic errors
- [ ] Set conservative risk limits (start small)
- [ ] Monitor first 24 hours continuously
- [ ] Have Kalshi API credentials with limited balance

Safety features active:
- ✅ RiskManager enforces exposure limits
- ✅ PositionTracker prevents duplicates
- ✅ PendingOrderRegistry prevents double-submission
- ✅ Staleness check before strategy evaluation
- ✅ Break-even validation before entry
- ✅ Bankroll deduction prevents over-allocation
- ✅ Position reconciliation on startup (with retry)
- ✅ Kill switch (F12) for emergency halt with order cancellation
- ✅ Order timeout detection (30s default)
- ✅ Slippage buffer in strategy evaluation
- ✅ Error handling (no critical unwraps)
