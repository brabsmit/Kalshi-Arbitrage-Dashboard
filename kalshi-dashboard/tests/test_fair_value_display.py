import pytest
import json
from playwright.sync_api import expect
from datetime import datetime

# Helper to generate Odds API response
def generate_odds_response():
    # Use static time to match test expectations if needed, but current time is fine for logic
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

def test_fair_value_display(authenticated_page):
    """
    Verify that 'Fair Value' is displayed in Cents instead of 'Fair Odds' (American).
    """
    page = authenticated_page

    # Mock Odds API (Handle both sports list and odds)
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

    # Inject Trade History for Analysis Modal test
    page.evaluate("""() => {
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

    # Reload to fetch data and pick up local storage
    page.reload()

    # --- 1. MARKET LIST VERIFICATION ---

    # Wait for market row
    row = page.locator("tr").filter(has_text="Buffalo Bills").first
    expect(row).to_be_visible(timeout=10000)

    # Expand row and check details
    row.click()

    # Check for "Fair Value:" label (was "Fair Odds:")
    # We use a filter to ensure we match the label inside the details section, although text matching is usually unique enough
    expect(page.get_by_text("Fair Value:", exact=True)).to_be_visible()

    # Check for value ending in ¢ (57¢) in the details container
    details_container = page.locator('div[id^="details-"]')
    expect(details_container.get_by_text("57¢")).to_be_visible()


    # --- 2. ANALYSIS MODAL VERIFICATION ---

    # We need a position to see the Analysis button in Portfolio
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

    # Trigger mock position load
    page.reload()

    # Switch to "positions" tab
    page.get_by_text("positions", exact=True).click()

    # Click Info icon (Info size=16)
    # It has aria-label="Trade Analysis"
    page.get_by_label("Trade Analysis").first.click()

    # Check Modal Header
    expect(page.get_by_text("Trade Analysis")).to_be_visible()

    # Target the modal specifically (class="fixed inset-0 z-50 ...")
    modal = page.locator("div.fixed.inset-0.z-50")

    # Check Table Header "Fair Value" (was "Fair Odds")
    expect(modal.locator("th", has_text="Fair Value")).to_be_visible()
    expect(modal.locator("th", has_text="Fair Odds")).not_to_be_visible()

    # Check Cell Content "57¢"
    expect(modal.locator("td", has_text="57¢")).to_be_visible()
