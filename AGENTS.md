# Agent Instructions

This repository contains a React-based dashboard for arbitrage trading (`kalshi-dashboard`) and a suite of Python-based verification scripts and tests.

## Versioning

When making changes to the application, please update the version number and date in `kalshi-dashboard/src/App.jsx` before submitting a pull request. The version and date are displayed in the `Header` component.

## Dependencies

To work with this repository, you must install the required dependencies for both the frontend application and the backend testing suite.

### Frontend (Node.js)

The frontend application is located in the `kalshi-dashboard/` directory.

1.  Navigate to the dashboard directory:
    ```bash
    cd kalshi-dashboard
    ```
2.  Install Node.js dependencies:
    ```bash
    npm install
    ```

### Backend (Python)

The project uses Python for testing (pytest) and verification (Playwright).

1.  Install Python packages:
    ```bash
    pip install pytest playwright pytest-playwright cryptography
    ```
2.  Install Playwright browser binaries:
    ```bash
    playwright install
    ```

## Running Tests

Tests are located in `kalshi-dashboard/tests/`. They use `pytest` and `playwright`.

To run the regression tests (mocked environment):
```bash
cd kalshi-dashboard
pytest tests/test_regression.py
```

To run all tests:
```bash
cd kalshi-dashboard
pytest
```

## Live Mode & Secrets

To run tests against the live Kalshi Demo API, you need to configure credentials.

1.  Run the setup script to save your API keys:
    ```bash
    cd kalshi-dashboard
    ./setup_secrets.sh
    ```
    This script will create a `.secrets/` directory (ignored by git) and store your credentials there.

2.  Run tests in live mode:
    ```bash
    TEST_LIVE=1 pytest tests/test_live.py
    ```

## Directory Structure

*   `kalshi-dashboard/`: Main React application.
    *   `src/`: Source code.
    *   `tests/`: Pytest suite.
    *   `verify_frontend.py`: Script to verify frontend rendering.
    *   `verify_portfolio.py`: Script to verify portfolio logic.
*   `verification/`: Additional standalone verification scripts.
