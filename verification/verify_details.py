from playwright.sync_api import sync_playwright, expect
import time

def verify_market_scanner_details():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Inject mock data to avoid depending on external APIs
        page.route("**/*", lambda route: route.continue_())

        # Navigate to the app
        page.goto("http://localhost:3000/")

        # Inject mock odds data directly into the App state/logic by mocking the fetch response
        # Since the app fetches from the-odds-api, we mock that
        page.route("**/odds/?**", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='''[
                {
                    "id": "abc-123",
                    "sport_key": "americanfootball_nfl",
                    "sport_title": "NFL",
                    "commence_time": "2024-10-27T20:00:00Z",
                    "home_team": "Team A",
                    "away_team": "Team B",
                    "bookmakers": [
                        {
                            "key": "fanduel",
                            "title": "FanDuel",
                            "last_update": "2024-10-27T10:00:00Z",
                            "markets": [
                                {
                                    "key": "h2h",
                                    "outcomes": [
                                        {"name": "Team A", "price": -110},
                                        {"name": "Team B", "price": -110}
                                    ]
                                }
                            ]
                        },
                         {
                            "key": "draftkings",
                            "title": "DraftKings",
                            "last_update": "2024-10-27T10:00:00Z",
                            "markets": [
                                {
                                    "key": "h2h",
                                    "outcomes": [
                                        {"name": "Team A", "price": -115},
                                        {"name": "Team B", "price": -105}
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]'''
        ))

        # Mock Kalshi API to ensure match found
        page.route("**/api/kalshi/markets?**", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='''{
                "markets": [
                    {
                        "ticker": "KXNFL-24OCT27-TEAMA-TEAMB",
                        "event_ticker": "KXNFL-24OCT27",
                        "market_type": "winner",
                        "yes_bid": 50,
                        "yes_ask": 52,
                        "volume": 1000,
                        "open_interest": 500,
                        "title": "Team A vs Team B",
                        "subtitle": "Winner",
                        "category": "Sports",
                        "yes_sub_title": "Team A",
                        "no_sub_title": "Team B"
                    }
                ]
            }'''
        ))

        # Set API key to trigger fetch
        page.evaluate("localStorage.setItem('odds_api_key', 'test_key')")
        page.reload()

        # Wait for the market row to appear
        # The row contains "Team A vs Team B"
        try:
            row = page.get_by_text("Team A vs Team B").first
            row.wait_for(timeout=10000)

            # Click the row to expand
            row.click()

            # Wait for details to appear
            # We expect "Odds Sources" and "Vig-Free Valuation"
            expect(page.get_by_text("Odds Sources")).to_be_visible()
            expect(page.get_by_text("Vig-Free Valuation")).to_be_visible()
            expect(page.get_by_text("FanDuel")).to_be_visible()
            expect(page.get_by_text("DraftKings")).to_be_visible()

            # Take screenshot
            page.screenshot(path="verification/market_details.png")
            print("Verification successful, screenshot saved.")

        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="verification/failure.png")

        finally:
            browser.close()

if __name__ == "__main__":
    verify_market_scanner_details()
