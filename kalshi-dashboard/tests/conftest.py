import pytest
import os
import subprocess
import time
from playwright.sync_api import sync_playwright
import logging
from .mock_data import MOCK_BALANCE, MOCK_MARKETS, MOCK_ORDERS, MOCK_POSITIONS, MOCK_HISTORY, MOCK_ORDER_RESPONSE

logging.basicConfig(level=logging.INFO)

# Determine if running in LIVE mode
TEST_LIVE = os.environ.get("TEST_LIVE") == "1"

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
        ["node", "./node_modules/vite/bin/vite.js", "--port", "3000", "--host", "0.0.0.0"],
        cwd=".",
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
    context = browser.new_context()
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

    if TEST_LIVE:
        try:
            with open(".secrets/demo_key_id", "r") as f:
                key_id = f.read().strip()
            with open(".secrets/demo_private.key", "r") as f:
                private_key = f.read().strip()
            logging.info("LIVE MODE: Loaded real credentials from .secrets/")
        except FileNotFoundError:
            pytest.fail("TEST_LIVE=1 but .secrets/demo_key_id or .secrets/demo_private.key not found.")
    else:
        key_id = "test_key_id"
        # Valid PEM key for node-forge
        private_key = """-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCyBLCB9F+FDbPl
gjpgeqQ7JRR4W3avzPuKALBasY1RTVLK4V05f1a/3FnUZ7EJoXe5G+yMftWrhHJM
sfroejiNnW7/SH95XjxvQZr98LlYuFg1cfOYPtI4g2W9u2e8dh9D1jtg7WMahAPA
e3OwQy7LMp2WuGOZJHislYfh5pE9VhQpSGCKZK88TXC+M1QTXBnAXtItcJrgr0IC
z42sZ1T0FPF1W89MioVoPHw9quYJdGqoPqzQZMun3lNcHPREJvg1kBSFtEquqs1u
wEwfh+BUqaDESpan6299SuA9VYiirHEkinlvpR3ZTQ74I/SDAEmyJuxHRcgnoEpV
L/qAKEWHAgMBAAECggEAFX0ZbWZ5TU9dItw4fcLwJi+QrAKmbgw5ZOw2XYxHOcQy
tUjE/xbO+vP3Z/toVHhIQnELed4pnr2rKnTli8CNKRMS/f/bW2QzuV5a/kJbrUj7
ZOAvfnY+3BGIa4G+wPIlTgQDQO0G5IGBDnAYg/NoJ6EhgrsZUrgjVPnr4Cn76EJT
LDDe0xOv3DwK6h1aleDUSr5Yj8eaqgEIGI/k4vd3c/4EWrZJXebEBgervp/nviXC
mF13/Wy0vDhNVHaucAV2OtnfjlSkbKJvW/J9y41t/AuXiAZ6ipqTBorVTxk3X6FE
8USfs4IO7grVR8o4mWX7STNfjhxC2Ulx2KAgm14mEQKBgQDgdRXdGdS+D80lUamO
OwYp55fI7daaGKR1ursKr7EyPuYBK53aKIpy1+dxDULcJ5WM+2tgzoZdWgtUY1/f
3aXyUHtihRnNT8H0yvHL8gfnaypGif0ghtNYIK3cVxwUj7q/02pBlK7AhRaW699s
Q6u4X058rOIIwM/DB5nM7ps3jwKBgQDLCPJgGrHTNgSkaK28CE/plTBsO89h+J/Y
TN6mbQWIj+v5fLAzuAK6fImrGkiSokybZdNRWaOYX9j2/H3y0gHXD06r2Ox3Lld8
PVwVhIqBGZkf7Wo2DcV89+ngA6ewTQq4hArL/sKjnJPRLfh5PqHJ8p4p2gPuVpe7
f1tv4/rWiQKBgBmoyOsRvORNYiJWB5Ae50F7HDr4FYRgNMzQn/lExHj9/8U6ez0p
TUp7rBWccnxAejQ3ubrDYVDirlDjW154NDRTRweoN57k80NMv/+Ul5q5AYg21h0V
zKtScQ2zV55yH+M2A/ujR6byj/aI2G3D/qmBG7Pc/6oIgLfG8qoezNe5AoGAcvun
IAweJwpRiLaLpZBjiVpnKPSaVtaR19J4yXG2j4dKUWlu9GtCiFBdOtxQu1JU5jC9
gzWrs3CclAucXHbYee3+VM4t5LUG8KJjUwBT3BceI/m1i9Uywbo45hfL0Mlgx+xn
nO2zVysmf3F0ZV22DINtVTBVx5Wcqp/OrchD11kCgYB6bF+LtvY5Kixf+KX8Rxoc
lnAfoaF47SQCVbdooOO2YyFig4cVKP43BRrOsTfdhzNi3OGkTMSxm8AZWOkSYBUw
sdE/KuZECWlhu20rrU8JBHy9ofbaJnaAgaVj9f5V2FY5RKlU8CpOnpRRtuCd8YGq
CtHoEs5ra5IaGxxb413soA==
-----END PRIVATE KEY-----"""

    # In Mock mode, we inject mock trade history.
    # In Live mode, we depend on actual history (which might be empty).
    history_script = ""
    if not TEST_LIVE:
        mock_trade_history = {
            "KXNBAGAME-23OCT20-LAL-DEN": {
                "ticker": "KXNBAGAME-23OCT20-LAL-DEN",
                "event": "Lakers vs Nuggets",
                "fairValue": 30,
                "orderPlacedAt": 1697800000000,
                "oddsTime": 1697799900000
            }
        }
        import json
        history_json = json.dumps(mock_trade_history).replace('"', '\\"')
        history_script = f"localStorage.setItem('kalshi_trade_history', '{history_json}');"

    # Navigate first to set local storage
    page.goto("http://localhost:3000")

    # We must properly escape newlines for JS template string
    private_key_js = private_key.replace('\n', '\\n')

    page.evaluate(f"""() => {{
        localStorage.setItem('kalshi_keys', JSON.stringify({{
            keyId: '{key_id}',
            privateKey: `{private_key_js}`
        }}));
        localStorage.setItem('odds_api_key', 'mock_odds_key');
        {history_script}
    }}""")

    page.reload()
    return page
