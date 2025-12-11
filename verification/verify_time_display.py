
import json
import time
import re
from playwright.sync_api import sync_playwright, expect

# --- MOCK DATA ---

MOCK_ODDS_RESPONSE = [
    {
        "id": "game_1",
        "sport_key": "americanfootball_nfl",
        "commence_time": "2023-10-26T20:00:00Z",
        "home_team": "Buffalo Bills",
        "away_team": "Tampa Bay Buccaneers",
        "bookmakers": [
            {
                "key": "fanduel",
                "title": "FanDuel",
                "last_update": "2023-10-26T12:00:00Z",
                "markets": [
                    {
                        "key": "h2h",
                        "outcomes": [
                            {"name": "Buffalo Bills", "price": -150},
                            {"name": "Tampa Bay Buccaneers", "price": 130}
                        ]
                    }
                ]
            }
        ]
    }
]

MOCK_KALSHI_MARKETS = {
    "markets": [
        {
            "ticker": "KXNFLGAME-23OCT26-TB-BUF",
            "event_ticker": "NFL-23OCT26-TB-BUF",
            "yes_bid": 40,
            "yes_ask": 45,
            "volume": 1000,
            "open_interest": 500,
            "status": "active"
        }
    ]
}

def verify_time_display():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("request", lambda req: print(f"REQ: {req.url}"))
        page.on("requestfailed", lambda req: print(f"REQ FAILED: {req.url} {req.failure}"))

        # 1. SETUP MOCKS

        # Mock /api/kalshi/markets
        page.route("**/api/kalshi/markets*", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(MOCK_KALSHI_MARKETS)
        ))

        # Combined handler for The-Odds-API
        def handle_odds_api(route):
            url = route.request.url
            print(f"Intercepted Odds API: {url}")
            if "/odds/" in url:
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(MOCK_ODDS_RESPONSE),
                    headers={"x-requests-used": "0", "x-requests-remaining": "500"}
                )
            else:
                 # Sports List
                 route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps([{"key": "americanfootball_nfl", "title": "NFL", "active": True, "kalshiSeries": "KXNFLGAME"}])
                )

        # Regex pattern
        page.route(re.compile(r".*the-odds-api\.com.*"), handle_odds_api)

        # Mock Portfolio
        page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json={"balance": 100000}))
        page.route("**/api/kalshi/portfolio/orders*", lambda route: route.fulfill(json={"orders": []}))
        page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(json={"market_positions": []}))

        # 2. NAVIGATE
        page.goto("http://localhost:3000")
        page.evaluate("localStorage.setItem('odds_api_key', 'test_key')")
        page.reload()

        # Wait for "Buffalo Bills" to appear
        try:
            row = page.locator("tr").filter(has_text="Buffalo Bills").first
            expect(row).to_be_visible(timeout=10000)
        except AssertionError:
            print("Row not found. Taking screenshot.")
            page.screenshot(path="verification/failed_load.png")
            raise

        # 3. VERIFY TIME DISPLAY
        print("Taking screenshot of the market row...")
        page.screenshot(path="verification/verification.png")
        print("Screenshot saved to verification/verification.png")

        print("Row Text:", row.inner_text())

        browser.close()

if __name__ == "__main__":
    verify_time_display()
