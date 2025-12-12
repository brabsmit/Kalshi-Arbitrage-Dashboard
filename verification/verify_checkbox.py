import time
import json
from playwright.sync_api import sync_playwright

def verify_market_scanner_checkbox(page):
    # Mock API responses
    def handle_sports(route):
        route.fulfill(json=[
            {"key": "americanfootball_nfl", "title": "NFL", "active": True, "group": "American Football"}
        ])

    def handle_odds(route):
        route.fulfill(json=[
            {
                "id": "game1",
                "sport_key": "americanfootball_nfl",
                "sport_title": "NFL",
                "commence_time": "2023-10-27T00:15:00Z",
                "home_team": "Buffalo Bills",
                "away_team": "Tampa Bay Buccaneers",
                "bookmakers": [
                    {
                        "key": "fanduel",
                        "title": "FanDuel",
                        "last_update": "2023-10-26T20:00:00Z",
                        "markets": [
                            {
                                "key": "h2h",
                                "outcomes": [
                                    {"name": "Buffalo Bills", "price": -400},
                                    {"name": "Tampa Bay Buccaneers", "price": 300}
                                ]
                            }
                        ]
                    }
                ]
            }
        ])

    def handle_kalshi_markets(route):
        route.fulfill(json={
            "markets": [
                {
                    "ticker": "KXNFL-BUF-TB-23OCT26",
                    "event_ticker": "NFL-BUF-TB-23OCT26",
                    "market_type": "Game",
                    "game_id": "game1",
                    "title": "Buffalo Bills vs Tampa Bay Buccaneers",
                    "subtitle": "Winner",
                    "open_interest": 100,
                    "volume": 1000,
                    "yes_bid": 80,
                    "yes_ask": 82,
                    "expiration_time": "2023-10-27T04:00:00Z",
                    "status": "active"
                }
            ]
        })

    # Enable request interception
    page.route("**/*api.the-odds-api.com/v4/sports/?*", handle_sports)
    page.route("**/*api.the-odds-api.com/v4/sports/*/odds/?*", handle_odds)
    page.route("**/api/kalshi/markets*", handle_kalshi_markets)

    # Navigate to the dashboard
    page.goto("http://localhost:3000")

    # Wait for the Market Scanner to load a row
    # The row should contain "Buffalo Bills"
    # We also need to make sure the app thinks it has an API key to even try fetching.
    # We can inject local storage before reload or fill the input.

    # Check if we need to input API key
    if page.is_visible("text=Bot Configuration"):
        # Fill API key if modal is open (unlikely on fresh load, usually hidden)
        pass

    # Force API key into localStorage
    page.evaluate("localStorage.setItem('odds_api_key', 'test_key')")
    page.reload()

    page.wait_for_selector("text=Buffalo Bills", timeout=10000)

    # Now verify checkboxes
    header_checkbox = page.locator("thead input[type='checkbox']")
    row_checkbox = page.locator("tbody tr:first-child input[type='checkbox']")

    # 1. Verify Default State (All Selected)
    print("Verifying default state...")
    if not header_checkbox.is_checked():
        print("Error: Header checkbox should be checked by default (when markets exist)")

    if not row_checkbox.is_checked():
        print("Error: Row checkbox should be checked by default")

    # 2. Deselect Row
    print("Deselecting row...")
    row_checkbox.uncheck()
    time.sleep(0.5)

    # Header should now be unchecked (since not all are selected)
    if header_checkbox.is_checked():
        print("Error: Header checkbox should be unchecked when a row is deselected")

    # 3. Select All via Header
    print("Selecting all via header...")
    header_checkbox.check()
    time.sleep(0.5)

    if not row_checkbox.is_checked():
        print("Error: Row checkbox should be checked after Select All")

    # 4. Deselect All via Header
    print("Deselecting all via header...")
    header_checkbox.uncheck()
    time.sleep(0.5)

    if row_checkbox.is_checked():
        print("Error: Row checkbox should be unchecked after Deselect All")

    # Take a screenshot of the Market Scanner area
    page.screenshot(path="verification/market_scanner_checkbox_verified.png")
    print("Screenshot taken at verification/market_scanner_checkbox_verified.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_market_scanner_checkbox(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
