# Testing Suite for Kalshi Dashboard

This suite verifies the Kalshi Dashboard application using Playwright and pytest. It supports two modes: **Mock Mode** (default) and **Live Mode** (against Kalshi Demo API).

## Prerequisites

- Python 3.10+
- Node.js & npm (for running the Vite server)
- `pytest` and `pytest-playwright`

## Installation

1. Install Python dependencies:
   ```bash
   pip install pytest pytest-playwright
   ```

2. Install Playwright browsers:
   ```bash
   playwright install chromium
   ```

3. Install Node.js dependencies:
   ```bash
   cd kalshi-dashboard
   npm install
   ```

## Running Tests (Mock Mode)

Mock mode runs tests against simulated data. This is the default and recommended for logic verification.

```bash
cd kalshi-dashboard
pytest tests/test_dashboard.py
```

## Running Tests (Live Demo Mode)

Live mode runs integration smoke tests against the actual Kalshi Demo API.

### 1. Setup Credentials

Create a `.secrets` directory in `kalshi-dashboard/` and add your Demo API credentials:

```bash
mkdir -p kalshi-dashboard/.secrets
echo "YOUR_KEY_ID" > kalshi-dashboard/.secrets/demo_key_id
echo "YOUR_PRIVATE_KEY_CONTENT" > kalshi-dashboard/.secrets/demo_private.key
```

*Note: Ensure `demo_private.key` contains the full PEM content (including BEGIN/END headers).*

### 2. Run Live Tests

Run with the `TEST_LIVE=1` environment variable. This will disable mocks and use your credentials.

```bash
cd kalshi-dashboard
TEST_LIVE=1 pytest tests/test_live.py
```

*Warning: Live tests depend on the state of your demo account and market availability. They verify connectivity but may verify less specific data logic than mock tests.*

## Test Structure

- **tests/conftest.py**: Configures the test environment.
    - Starts Vite server automatically.
    - **Mock Mode**: Injects dummy keys and mocks `/api/kalshi/*` responses.
    - **Live Mode**: Reads real keys from `.secrets/` and allows network pass-through.
- **tests/test_dashboard.py**: Functional tests using **Mock Data**. Verified logic for Positions, Orders, History, etc.
- **tests/test_live.py**: Integration smoke tests using **Live Data**. Verifies connectivity and balance fetch.
