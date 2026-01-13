import pytest
import os
import subprocess
import time
from playwright.sync_api import sync_playwright
import logging
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from .mock_data import MOCK_BALANCE, MOCK_MARKETS, MOCK_ORDERS, MOCK_POSITIONS, MOCK_HISTORY, MOCK_ORDER_RESPONSE

logging.basicConfig(level=logging.INFO)

# Determine if running in LIVE mode
# We also enable live mode if the keys are present in the environment
HAS_KEYS = "KALSHI_DEMO_API_KEY" in os.environ and "KALSHI_DEMO_API_KEY_ID" in os.environ
TEST_LIVE = os.environ.get("TEST_LIVE") == "1" or HAS_KEYS

def generate_mock_key():
    """Generates a temporary RSA private key for testing."""
    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    return pem.decode('utf-8')

# Fixture to start Vite server
@pytest.fixture(scope="session", autouse=True)
def vite_server():
    # Kill any existing on port 3000 (best effort)
    try:
        subprocess.run(["pkill", "-f", "vite"], check=False)
    except FileNotFoundError:
        pass

    logging.info("Starting Vite server...")
    env = os.environ.copy()
    # Set to demo API
    env["KALSHI_API_URL"] = "https://demo-api.kalshi.co"

    # Start Vite server
    # We assume the user runs pytest from the 'kalshi-dashboard' directory.
    process = subprocess.Popen(
        ["node", "./node_modules/vite/bin/vite.js", "--port", "3000", "--host", "127.0.0.1"],
        cwd="kalshi-dashboard",
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Wait for server to start
    time.sleep(10)

    yield process

    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()

@pytest.fixture(scope="function")
def context(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(ignore_https_errors=True)
    yield context
    browser.close()

@pytest.fixture(scope="function")
def page(context):
    page = context.new_page()
    yield page
    page.close()

@pytest.fixture(scope="function")
def mock_api(page):
    """Mocks Kalshi API responses if enabled (NOT LIVE)."""
    if TEST_LIVE:
        logging.info("LIVE MODE: Skipping network mocks.")
        return

    # Mock Balance
    page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json=MOCK_BALANCE))

    # Mock Markets
    page.route("**/api/kalshi/markets*", lambda route: route.fulfill(json=MOCK_MARKETS))

    # Mock Orders (GET/POST/DELETE)
    def handle_orders(route):
        if route.request.method == "GET":
            route.fulfill(json=MOCK_ORDERS)
        elif route.request.method == "POST":
            route.fulfill(json=MOCK_ORDER_RESPONSE)
        elif route.request.method == "DELETE":
            route.fulfill(status=200, json={})
        else:
             route.continue_()

    page.route("**/api/kalshi/portfolio/orders*", handle_orders)

    # Mock Positions (GET)
    def handle_positions(route):
        url = route.request.url
        if "settlement_status=settled" in url:
            route.fulfill(json=MOCK_HISTORY)
        else:
            route.fulfill(json=MOCK_POSITIONS)

    page.route("**/api/kalshi/portfolio/positions*", handle_positions)


@pytest.fixture(scope="function")
def authenticated_page(page):
    """Injects credentials into localStorage and reloads page."""

    key_id = ""
    private_key = ""
    odds_key = os.environ.get("THE_ODDS_API_KEY", "mock_odds_key")
    # Clean up double pasted keys if detected (common issue)
    if len(odds_key) == 64 and odds_key[:32] == odds_key[32:]:
        odds_key = odds_key[:32]

    if TEST_LIVE:
        if "KALSHI_DEMO_API_KEY" in os.environ and "KALSHI_DEMO_API_KEY_ID" in os.environ:
             key_id = os.environ["KALSHI_DEMO_API_KEY_ID"]
             private_key = os.environ["KALSHI_DEMO_API_KEY"]
             logging.info("LIVE MODE: Loaded credentials from environment variables.")
        else:
            try:
                with open(".secrets/demo_key_id", "r") as f:
                    key_id = f.read().strip()
                with open(".secrets/demo_private.key", "r") as f:
                    private_key = f.read().strip()
                logging.info("LIVE MODE: Loaded real credentials from .secrets/")
            except FileNotFoundError:
                pytest.fail("TEST_LIVE=1 but credentials not found in env or .secrets/.")
    else:
        key_id = "test_key_id"
        # Generate dynamic key
        private_key = generate_mock_key()

    # Navigate first to set local storage
    page.goto("https://127.0.0.1:3000")

    # We must properly escape newlines for JS template string
    private_key_js = private_key.replace('\n', '\\n')

    page.evaluate(f"""() => {{
        localStorage.setItem('kalshi_keys', JSON.stringify({{
            keyId: '{key_id}',
            privateKey: `{private_key_js}`
        }}));
        localStorage.setItem('odds_api_key', '{odds_key}');
    }}""")

    page.reload()
    return page
