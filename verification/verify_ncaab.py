
import json
import time
from playwright.sync_api import sync_playwright, expect

def generate_ncaab_odds_response():
    return [
        {
            "id": "event_ncaab_1",
            "sport_key": "basketball_ncaab",
            "commence_time": "2024-03-20T20:00:00Z",
            "home_team": "Duke Blue Devils",
            "away_team": "North Carolina Tar Heels",
            "bookmakers": [
                {
                    "key": "fanduel",
                    "title": "FanDuel",
                    "last_update": "2024-03-20T12:00:00Z",
                    "markets": [
                        {
                            "key": "h2h",
                            "outcomes": [
                                {"name": "Duke Blue Devils", "price": -120},
                                {"name": "North Carolina Tar Heels", "price": 100}
                            ]
                        }
                    ]
                }
            ]
        }
    ]

def generate_kalshi_markets_ncaab():
    return {
        "markets": [
            {
                "ticker": "KXNCAABGAME-24MAR20-DUK-UNC",
                "event_ticker": "NCAAB-24MAR20-DUK-UNC",
                "yes_bid": 52,
                "yes_ask": 56,
                "volume": 500,
                "open_interest": 200,
                "status": "active"
            }
        ]
    }

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Inject Mock Forge for auth
    page.add_init_script("""
        window.forge = {
            pki: { privateKeyFromPem: () => ({ sign: () => 'MOCK_SIG' }) },
            md: { sha256: { create: () => ({ update: () => {}, digest: () => {} }) } },
            mgf: { mgf1: { create: () => {} } },
            pss: { create: () => {} },
            util: { encode64: () => 'MOCK_SIG_B64' }
        };
    """)

    # Mock localStorage
    page.add_init_script("""
        localStorage.setItem('kalshi_keys', JSON.stringify({keyId: 'test_id', privateKey: 'test_key'}));
        localStorage.setItem('odds_api_key', 'test_odds_key');
    """)

    # Mock APIs
    def handle_odds_api(route):
        url = route.request.url
        if "/odds/" in url:
            if "basketball_ncaab" in url:
                 route.fulfill(json=generate_ncaab_odds_response())
            else:
                 route.fulfill(json=[])
        else:
            # Sports List
            route.fulfill(json=[
                {"key": "americanfootball_nfl", "title": "Football (NFL)", "active": True},
                {"key": "basketball_ncaab", "title": "Basketball (NCAAB)", "active": True}
            ])
    page.route("**/api.the-odds-api.com/**", handle_odds_api)

    def handle_kalshi_markets(route):
        route.fulfill(json=generate_kalshi_markets_ncaab())
    page.route("**/api/kalshi/markets*", handle_kalshi_markets)

    page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json={"balance": 50000}))
    page.route("**/api/kalshi/portfolio/orders*", lambda route: route.fulfill(json={"orders": []}))
    page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(json={"market_positions": []}))

    # Go to app
    page.goto("http://localhost:3000")

    # Wait for app to load
    page.wait_for_selector("h1", state="visible")

    # Open Sport Filter
    # "1 Sport" because NFL is selected by default
    sport_btn = page.get_by_text("1 Sport")
    if not sport_btn.count():
        sport_btn = page.get_by_text("Select Sports")

    sport_btn.click()

    # Wait a bit for animation
    page.wait_for_timeout(500)
    page.screenshot(path="verification/dropdown_debug.png")

    # Check if NCAAB is there
    ncaab_option = page.get_by_text("Basketball (NCAAB)")
    expect(ncaab_option).to_be_visible()

    # Select it
    ncaab_option.click()

    # Close filter
    page.mouse.click(0, 0)

    # Force Refresh/Start
    start_btn = page.get_by_role("button", name="Start")
    if start_btn.is_visible():
        start_btn.click()

    # Check for the Duke game
    duke_row = page.locator("tr").filter(has_text="Duke Blue Devils")
    expect(duke_row).to_be_visible(timeout=10000)

    # Take screenshot
    page.screenshot(path="verification/ncaab_verification.png")
    print("Verification successful, screenshot saved to verification/ncaab_verification.png")

    browser.close()

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
