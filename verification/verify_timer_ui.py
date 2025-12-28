import time
from playwright.sync_api import sync_playwright

def verify_timer_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--ignore-certificate-errors'])
        page = browser.new_page(ignore_https_errors=True)

        # Mock API to return specific market data
        page.route("**/*", lambda route: route.continue_())

        # Inject mock data via intercept
        def handle_odds(route):
            route.fulfill(
                status=200,
                content_type="application/json",
                body='[{"key": "americanfootball_nfl", "title": "NFL", "active": true}]'
            )
        page.route("https://api.the-odds-api.com/v4/sports/?apiKey=*", handle_odds)

        # Navigate
        page.goto("https://localhost:3000")

        # Add Mock Market Data directly into React state or intercept fetch
        # Since logic is in fetchLiveOdds which calls API, we mock the API response

        mock_odds_response = [{
            "id": "e4587394d758c067e719c8a2d103138b",
            "sport_key": "americanfootball_nfl",
            "commence_time": "2024-10-27T12:00:00Z", # Assume current time is before this
            "home_team": "Team A",
            "away_team": "Team B",
            "bookmakers": [{
                "key": "fanduel",
                "title": "FanDuel",
                "last_update": "2024-10-27T11:50:00Z",
                "markets": [{
                    "key": "h2h",
                    "outcomes": [
                        {"name": "Team A", "price": -110},
                        {"name": "Team B", "price": -110}
                    ]
                }]
            }]
        }]

        # We need to mock the Odds API response for the specific sport
        def handle_nfl_odds(route):
            route.fulfill(
                status=200,
                content_type="application/json",
                body=str(mock_odds_response).replace("'", '"').replace("True", "true").replace("False", "false")
            )
        # page.route("**/odds/?*", handle_nfl_odds)

        # Wait for page load
        page.wait_for_selector("text=Kalshi ArbBot")

        # Take screenshot
        page.screenshot(path="verification/verify_timer_ui.png")
        print("Screenshot saved to verification/verify_timer_ui.png")

        browser.close()

if __name__ == "__main__":
    verify_timer_ui()
