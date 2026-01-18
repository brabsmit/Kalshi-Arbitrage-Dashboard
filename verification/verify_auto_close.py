
import asyncio
from playwright.async_api import async_playwright
import time
import json
import logging
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("AutoCloseTest")

# Mock Data
MOCK_MARKET_ID = "KXTEST-24JAN01-TEAMA-TEAMB-TEAMA"
MOCK_EVENT_TICKER = "TEST-24JAN01-TEAMA-TEAMB"

MOCK_MARKETS = {
    "markets": [
        {
            "ticker": MOCK_MARKET_ID,
            "event_ticker": MOCK_EVENT_TICKER,
            "title": "Team A vs Team B Winner?", # Required for indexing
            "expected_expiration_time": "2024-01-01T20:00:00Z", # Required for indexing
            "yes_bid": 60,
            "yes_ask": 65,
            "volume": 1000,
            "open_interest": 500,
            "status": "active"
        }
    ]
}

MOCK_POSITIONS = {
    "market_positions": [
        {
            "ticker": MOCK_MARKET_ID,
            "market_ticker": MOCK_MARKET_ID,
            "position": 100,  # Holding 100 contracts
            "avg_price": 50,  # Bought at 50 cents
            "total_cost": 5000,
            "fees_paid": 50,
            "realized_pnl": 0,
            "settlement_status": "unsettled",
            "side": "yes"
        }
    ]
}

# Trade history to mimic bot opening the position
MOCK_TRADE_HISTORY = {
    MOCK_MARKET_ID: {
        "source": "auto",
        "orderPlacedAt": 1700000000000,
        "event": "Team A vs Team B",
        "fairValue": 60 # Fair value at time of entry (just for history)
    }
}

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

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(ignore_https_errors=True)
        page = await context.new_page()

        # Wait for server to be ready
        for i in range(10):
             try:
                 response = await page.request.get("https://127.0.0.1:3000")
                 if response.ok:
                     logger.info("Server is ready.")
                     break
             except Exception:
                 logger.info(f"Waiting for server... ({i+1}/10)")
                 time.sleep(2)

        # 1. Setup Request Interception
        await page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json={"balance": 1000000}))

        async def handle_markets(route):
            await route.fulfill(json=MOCK_MARKETS)

        await page.route("**/api/kalshi/markets*", handle_markets)

        # Mock Odds API - USING ** TO MATCH SUB-PATHS
        await page.route("https://api.the-odds-api.com/v4/sports/**", lambda route: route.fulfill(json=[
            {
                "id": "123",
                "sport_key": "americanfootball_nfl",
                "commence_time": "2024-01-01T20:00:00Z",
                "home_team": "Team A",
                "away_team": "Team B",
                "bookmakers": [
                    {
                        "key": "fanduel",
                        "title": "FanDuel",
                        "last_update": "2024-01-01T10:00:00Z",
                        "markets": [
                            {
                                "key": "h2h",
                                "outcomes": [
                                    {"name": "Team A", "price": -200}, # High prob ~66% => Fair Value ~66c
                                    {"name": "Team B", "price": 150}
                                ]
                            }
                        ]
                    }
                ]
            }
        ]))

        # Mock Sports List
        await page.route("https://api.the-odds-api.com/v4/sports/?*", lambda route: route.fulfill(json=[
             {"key": "americanfootball_nfl", "title": "NFL", "active": True}
        ]))

        await page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(json=MOCK_POSITIONS))
        await page.route("**/api/kalshi/portfolio/orders", lambda route: route.fulfill(json={"orders": []}))

        # Capture Order Placements
        order_placed = asyncio.Future()
        async def handle_order_post(route):
            try:
                post_data = route.request.post_data_json
                if post_data is None:
                    # Fallback to text parsing if needed
                    text = route.request.post_data
                    if text:
                        post_data = json.loads(text)

                logger.info(f"Order Placed: {post_data}")

                if post_data and post_data.get('action') == 'sell' and post_data.get('ticker') == MOCK_MARKET_ID:
                    if not order_placed.done():
                        order_placed.set_result(post_data)

                await route.fulfill(json={"order_id": "new_ord_1", "status": "placed"})
            except Exception as e:
                logger.error(f"Error handling order post: {e}")
                await route.continue_()

        await page.route("**/api/kalshi/portfolio/orders", handle_order_post)


        # 2. Inject Auth & Config
        logger.info("Navigating to dashboard...")
        await page.goto("https://127.0.0.1:3000")

        # Generate valid PEM key
        private_key = generate_mock_key()
        private_key_js = private_key.replace('\n', '\\n')

        logger.info("Injecting credentials...")
        await page.evaluate(f"""() => {{
            const keys = {{
                keyId: 'test_key',
                privateKey: `{private_key_js}`
            }};
            sessionStorage.setItem('kalshi_keys', JSON.stringify(keys));
            sessionStorage.setItem('authenticated', 'true');

            localStorage.setItem('odds_api_key', 'test_odds_key');
            localStorage.setItem('kalshi_trade_history', JSON.stringify({json.dumps(MOCK_TRADE_HISTORY)}));

            const config = JSON.parse(localStorage.getItem('kalshi_config') || '{{}}');
            config.isAutoClose = true;
            config.autoCloseMarginPercent = 10;
            config.selectedSports = ['americanfootball_nfl'];
            localStorage.setItem('kalshi_config', JSON.stringify(config));
        }}""")

        logger.info("Reloading page...")
        await page.reload()

        # 3. Start Bot
        logger.info("Waiting for wallet to trigger...")
        try:
            await page.wait_for_selector("text=Wallet Active", timeout=10000)
            logger.info("Wallet is Active.")
        except Exception:
             logger.warning("Wallet not active.")

        # Click "Start"
        try:
            start_btn = page.get_by_role("button", name="Start")
            if await start_btn.is_visible():
                await start_btn.click()
                logger.info("Bot Started via UI button.")
            else:
                 if await page.get_by_role("button", name="Pause").is_visible():
                     logger.info("Bot is already running.")
                 else:
                     logger.warning("Start button not visible/found.")
        except Exception as e:
            logger.error(f"Error clicking start: {e}")

        # Enable console logging
        page.on("console", lambda msg: print(f"Console: {msg.text}"))

        # 4. Wait for Auto-Close Trigger
        logger.info("Waiting for auto-close order...")
        try:
            order_data = await asyncio.wait_for(order_placed, timeout=20.0)
            logger.info(f"SUCCESS: Auto-close order placed: {order_data}")

            # Validation
            # Fair Value = 62c (derived from -200/150 odds).
            # Margin = 10%.
            # Target = 62 * 1.1 = 68.2 -> 68c.
            expected_price = order_data.get('price') or order_data.get('yes_price') or order_data.get('no_price')

            if expected_price >= 68:
                 print(f"PASS: Order price {expected_price} is correct.")
            else:
                 print(f"WARN: Order price {expected_price} is lower than expected (72).")

        except asyncio.TimeoutError:
            logger.error("FAIL: No auto-close order placed within timeout.")
            await page.screenshot(path="auto_close_fail.png")

            try:
                logs = await page.locator(".font-mono.text-xs").all_text_contents()
                print("UI Logs:", logs)
            except:
                pass

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
