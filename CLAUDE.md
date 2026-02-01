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
