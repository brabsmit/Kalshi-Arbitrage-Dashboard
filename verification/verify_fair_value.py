import json
import time
from playwright.sync_api import sync_playwright, expect
from datetime import datetime

# Helper to generate Odds API response
def generate_odds_response():
    now_iso = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    return [
        {
            "id": "event_123",
            "sport_key": "americanfootball_nfl",
            "commence_time": "2023-10-26T20:00:00Z",
            "home_team": "Buffalo Bills",
            "away_team": "Tampa Bay Buccaneers",
            "bookmakers": [
                {
                    "key": "fanduel",
                    "title": "FanDuel",
                    "last_update": now_iso,
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

def verify_fair_value(page):
    print("Setting up mocks...")

    # Mock Odds API
    def handle_odds_api(route):
        if "/odds/" in route.request.url:
             route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(generate_odds_response())
            )
        else:
             # Sports List
             route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps([{"key": "americanfootball_nfl", "title": "NFL", "active": True}])
            )

    page.route(lambda url: "api.the-odds-api.com" in url, handle_odds_api)

    # Mock Kalshi Markets
    page.route("**/api/kalshi/markets*", lambda route: route.fulfill(json={
        "markets": [
            {
                "ticker": "KXNFLGAME-23OCT26-TB-BUF",
                "event_ticker": "NFL-23OCT26-TB-BUF",
                "yes_bid": 55,
                "yes_ask": 60,
                "volume": 1000,
                "open_interest": 500,
                "status": "active"
            }
        ]
    }))

    # Mock Balance
    page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json={"balance": 100000}))

    print("Navigating...")
    # Navigate to localhost:3000 (Vite server must be running!)
    page.goto("https://localhost:3000", timeout=60000)

    # Inject Trade History for Analysis Modal
    page.evaluate("""() => {
        localStorage.setItem('odds_api_key', 'test_key');
        const history = {
            "KXNFLGAME-23OCT26-TB-BUF": {
                "event": "Buffalo Bills vs Tampa Bay Buccaneers",
                "ticker": "KXNFLGAME-23OCT26-TB-BUF",
                "sportsbookOdds": -150,
                "vigFreeProb": 57.98,
                "fairValue": 57,
                "bidPrice": 50,
                "orderPlacedAt": Date.now(),
                "oddsTime": Date.now() - 1000
            }
        };
        localStorage.setItem('kalshi_trade_history', JSON.stringify(history));
    }""")

    page.reload()

    print("Waiting for market row...")
    row = page.locator("tr").filter(has_text="Buffalo Bills").first
    expect(row).to_be_visible(timeout=20000)

    print("Expanding row...")
    row.click()

    print("Checking for Fair Value...")
    expect(page.get_by_text("Fair Value:", exact=True)).to_be_visible()

    details_container = page.locator('div[id^="details-"]')
    expect(details_container.get_by_text("57¢")).to_be_visible()

    print("Taking screenshot of expanded row...")
    page.screenshot(path="verification/verification_expanded_row.png")

    # --- Analysis Modal ---
    print("Opening Analysis Modal...")

    # Mock position to see Analysis button
    page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(json={
        "market_positions": [
            {
                "ticker": "KXNFLGAME-23OCT26-TB-BUF",
                "market_ticker": "KXNFLGAME-23OCT26-TB-BUF",
                "position": 10,
                "avg_price": 50,
                "total_cost": 500,
                "fees_paid": 5,
                "settlement_status": "unsettled"
            }
        ]
    }))

    page.reload()
    page.get_by_text("positions", exact=True).click()
    page.get_by_label("Trade Analysis").first.click()

    expect(page.get_by_text("Trade Analysis")).to_be_visible()

    print("Taking screenshot of Analysis Modal...")
    page.screenshot(path="verification/verification.png")
    print("Done.")

if __name__ == "__main__":
    with sync_playwright() as p:
        # Launch with ignore_https_errors because basicSsl
        browser = p.chromium.launch(headless=True, args=['--ignore-certificate-errors'])
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()
        try:
            verify_fair_value(page)
        finally:
            browser.close()
