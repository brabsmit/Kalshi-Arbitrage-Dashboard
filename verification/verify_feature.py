
from playwright.sync_api import sync_playwright

def verify_checkboxes():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Mock API responses to ensure data loads quickly and reliably
        page.route("https://api.the-odds-api.com/v4/sports/*/odds/*", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body="""[
                {
                    "id": "game1",
                    "sport_key": "americanfootball_nfl",
                    "commence_time": "2023-10-27T00:15:00Z",
                    "home_team": "Team A",
                    "away_team": "Team B",
                    "bookmakers": [
                        {
                            "key": "fanduel",
                            "title": "FanDuel",
                            "last_update": "2023-10-26T12:00:00Z",
                            "markets": [
                                {
                                    "key": "h2h",
                                    "outcomes": [
                                        {"name": "Team A", "price": -110},
                                        {"name": "Team B", "price": -110}
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]"""
        ))

        page.route("**/api/kalshi/markets*", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body="""{"markets": [
                {"ticker": "KXNFL-TEAMATEAMB-TEAMA", "event_ticker": "KXNFL-TEAMATEAMB", "yes_bid": 50, "yes_ask": 55, "volume": 1000, "open_interest": 500}
            ]}"""
        ))

        page.route("https://api.the-odds-api.com/v4/sports/*", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body="""[{"key": "americanfootball_nfl", "title": "NFL", "active": true, "has_outrights": false}]"""
        ))

        print("Navigating...")
        page.goto("http://localhost:3000")

        # Inject API key to trigger load
        print("Injecting API key...")
        page.evaluate("localStorage.setItem('odds_api_key', 'test_key')")
        page.reload()

        print("Waiting for table...")
        page.wait_for_selector("table", timeout=10000)
        page.wait_for_selector("input[type='checkbox']", timeout=10000)

        # Wait a bit for render
        page.wait_for_timeout(2000)

        print("Taking screenshot...")
        page.screenshot(path="verification/verification.png")
        print("Done.")
        browser.close()

if __name__ == "__main__":
    verify_checkboxes()
