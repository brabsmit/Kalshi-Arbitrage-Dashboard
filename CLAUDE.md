# Project Instructions

## Pre-Push Build

Before every `git push`, build the Windows executable and copy it to `kalshi-arb/`:

```bash
cd kalshi-arb && cargo build --release --target x86_64-pc-windows-gnu && cp target/x86_64-pc-windows-gnu/release/kalshi-arb.exe kalshi-arb.exe
```

Commit the updated `kalshi-arb/kalshi-arb.exe` if it changed.
