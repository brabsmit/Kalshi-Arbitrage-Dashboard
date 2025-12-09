
import logging
import time
import os
import subprocess
import json
import datetime
from playwright.sync_api import sync_playwright, expect

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def run_verification(page):
    # Mocking API calls
    # 1. Mock The-Odds-API
    page.route("**/sports/*/odds/*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps([{
            "id": "game1",
            "sport_key": "americanfootball_nfl",
            "sport_title": "NFL",
            "commence_time": (datetime.datetime.now() + datetime.timedelta(days=1)).isoformat() + "Z",
            "home_team": "TeamA",
            "away_team": "TeamB",
            "bookmakers": [{
                "key": "bookmaker1",
                "title": "Bookmaker 1",
                "last_update": (datetime.datetime.now()).isoformat() + "Z",
                "markets": [{
                    "key": "h2h",
                    "outcomes": [
                        {"name": "TeamA", "price": -150},
                        {"name": "TeamB", "price": 130}
                    ]
                }]
            }]
        }])
    ))

    # 2. Mock Kalshi Markets
    page.route("**/api/kalshi/markets*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({
            "markets": [{
                "ticker": "KX-TEST-TEAMA",
                "event_ticker": "KX-TEST",
                "game_id": "game1",
                "title": "TeamA vs TeamB",
                "yes_bid": 60, # High bid to trigger sell
                "yes_ask": 65,
                "volume": 1000,
                "open_interest": 500,
                "status": "active"
            }]
        })
    ))

    # 3. Mock Portfolio Balance
    page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps({"balance": 100000})
    ))

    # 4. Mock Portfolio Orders
    page.route("**/api/kalshi/portfolio/orders", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps({"orders": []})
    ))

    # 5. Mock Portfolio Positions (Active Held Position)
    # We simulate holding TeamA position bought at 50 cents.
    page.route("**/api/kalshi/portfolio/positions", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({
            "market_positions": [{
                "ticker": "KX-TEST-TEAMA",
                "position": 10,
                "avg_price": 50,
                "total_cost": 500,
                "fees_paid": 10,
                "status": "HELD",
                "created": (datetime.datetime.now() - datetime.timedelta(hours=2)).isoformat() + "Z"
            }]
        })
    ))

    # 6. Intercept POST /orders (The Close Action)
    captured_orders = []
    def handle_post_orders(route):
        try:
            req = route.request
            if req.method == "POST":
                data = req.post_data_json
                captured_orders.append(data)
                logging.info(f"CAPTURED ORDER: {data}")
                route.fulfill(status=200, body=json.dumps({"order_id": "order_123"}))
            else:
                route.continue_()
        except Exception as e:
            logging.error(f"Error handling post orders: {e}")
            route.continue_()

    page.route("**/api/kalshi/portfolio/orders", handle_post_orders)

    logging.info("Navigating to dashboard...")
    page.goto("http://localhost:3000")

    # Inject Fake Keys
    with open("kalshi-dashboard/verification/test_private.pem", "r") as f:
        private_key = f.read().strip()
    private_key_js = private_key.replace('\n', '\\n')

    page.evaluate(f"""() => {{
        localStorage.setItem('kalshi_keys', JSON.stringify({{
            keyId: 'test_key',
            privateKey: `{private_key_js}`
        }}));
        localStorage.setItem('odds_api_key', 'test_odds_key');

        // Inject OLD Trade History
        const now = Date.now();
        const twoHoursAgo = now - (2 * 60 * 60 * 1000);

        localStorage.setItem('kalshi_trade_history', JSON.stringify({{
            'KX-TEST-TEAMA': {{
                ticker: 'KX-TEST-TEAMA',
                orderPlacedAt: twoHoursAgo,
                fairValue: 55,
                bidPrice: 50,
                event: 'TeamA vs TeamB'
            }}
        }}));
    }}""")

    page.reload()

    # Wait for wallet active (key injection worked)
    page.wait_for_selector("text=Wallet Active", timeout=20000)

    # Wait for forge load
    time.sleep(2)

    # Set Auto-Close ON (it defaults to true, but good to be sure)
    # Check if "Auto-Close ON" button exists

    # Start the bot
    logging.info("Starting bot...")
    page.get_by_role("button", name="Start").click()

    # Wait for a while to allow auto-close logic to run
    logging.info("Waiting for auto-close logic...")
    time.sleep(10)

    # Check if order was placed
    if len(captured_orders) > 0:
        logging.info("FAILURE: Order was placed! The restriction did not work (or I misunderstood it).")
        # Check order details
        logging.info(f"Order details: {captured_orders[0]}")
    else:
        logging.info("SUCCESS: No order placed. The session restriction is working.")

    return len(captured_orders)

if __name__ == "__main__":
    try:
        subprocess.run(["pkill", "-f", "vite"], check=False)
    except:
        pass

    logging.info("Starting Dev Server...")
    # Clean environment variables to ensure no real API calls if leaks happen
    env = os.environ.copy()
    env["KALSHI_API_URL"] = "http://localhost:3000/api" # Mock url effectively

    server_process = subprocess.Popen(
        ["node", "./node_modules/vite/bin/vite.js", "--port", "3000"],
        cwd="kalshi-dashboard",
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Give it time to start
    time.sleep(5)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            orders_count = run_verification(page)
            browser.close()

            if orders_count == 0:
                print("VERIFICATION_RESULT: RESTRICTED")
            else:
                print("VERIFICATION_RESULT: NOT_RESTRICTED")

    except Exception as e:
        logging.error(f"Script failed: {e}")
    finally:
        server_process.terminate()
