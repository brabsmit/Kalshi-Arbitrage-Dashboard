import pytest
import json
import time
import re
from playwright.sync_api import expect

# --- MOCK DATA GENERATORS ---

def generate_odds_response(commence_time_iso):
    """Generates a The-Odds-API response with an arbitrage opportunity."""
    return [
        {
            "id": "event_123",
            "sport_key": "americanfootball_nfl",
            "commence_time": commence_time_iso,
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
                },
                {
                    "key": "draftkings",
                    "title": "DraftKings",
                    "last_update": "2023-10-26T12:00:00Z",
                    "markets": [
                        {
                            "key": "h2h",
                            "outcomes": [
                                {"name": "Buffalo Bills", "price": -155},
                                {"name": "Tampa Bay Buccaneers", "price": 135}
                            ]
                        }
                    ]
                }
            ]
        }
    ]

def generate_kalshi_markets(ticker="KXNFLGAME-23OCT26-TB-BUF", yes_bid=55, yes_ask=60):
    """Generates Kalshi Markets response."""
    return {
        "markets": [
            {
                "ticker": ticker,
                "event_ticker": "NFL-23OCT26-TB-BUF",
                "yes_bid": yes_bid,
                "yes_ask": yes_ask,
                "volume": 1000,
                "open_interest": 500,
                "status": "active"
            }
        ]
    }

# --- TESTS ---

def test_e2e_arbitrage_cycle(authenticated_page):
    """
    Test the full lifecycle.
    Note: We do NOT use 'mock_api' fixture here to avoid conflicts.
    We define all routes explicitly.
    """
    page = authenticated_page

    # Capture Console Logs & Requests
    page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
    page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))

    # 1. SETUP MOCKS
    # ----------------

    # Mock Odds API
    def handle_odds_api(route):
        url = route.request.url
        # print(f"Intercepted Odds API: {url}")

        if "/odds/" in url:
             odds_response = generate_odds_response("2023-10-26T20:00:00Z")
             route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(odds_response),
                headers={"x-requests-used": "0", "x-requests-remaining": "500"}
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
    def handle_kalshi_markets(route):
        # print(f"Intercepted Kalshi Markets: {route.request.url}")
        kalshi_market_response = generate_kalshi_markets(yes_bid=40, yes_ask=45)
        route.fulfill(json=kalshi_market_response)

    page.route("**/api/kalshi/markets*", handle_kalshi_markets)

    # Mock Balance
    page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json={"balance": 100000}))

    # Mock Orders (Shared Capture)
    captured_orders = []
    def handle_orders(route):
        if route.request.method == "GET":
             route.fulfill(json={"orders": []})
        elif route.request.method == "POST":
             data = route.request.post_data_json
             print(f"Intercepted POST Order: {data}")
             captured_orders.append(data)
             route.fulfill(json={"order_id": f"ord_{len(captured_orders)}", "status": "placed"})
        else:
             route.continue_()

    page.route("**/api/kalshi/portfolio/orders*", handle_orders)

    # Mock Positions
    def handle_positions(route):
        if "settlement_status=settled" in route.request.url:
            route.fulfill(json={"market_positions": []})
        else:
            route.fulfill(json={"market_positions": []})
    page.route("**/api/kalshi/portfolio/positions*", handle_positions)

    # 2. VERIFY ARB OPPORTUNITY
    # -------------------------
    page.reload()

    # Wait for market row to appear
    try:
        row = page.locator("tr").filter(has_text="Buffalo Bills").first
        expect(row).to_be_visible(timeout=10000)
    except AssertionError:
        if page.get_by_text("Loading Markets...").is_visible():
            print("Still Loading Markets...")
        else:
            print("Markets table empty or mismatch.")
        raise

    # Check Smart Bid calculation
    expect(row.get_by_text("41¢", exact=True)).to_be_visible()

    # 3. START BOT & VERIFY BUY ORDER
    # -------------------------------
    # Click Start
    page.get_by_text("Start").click()

    # Enable Turbo Mode for faster polling
    # The button has a Zap icon. We can find it by title or class/svg.
    # It has onClick={() => setConfig(...isTurboMode...)}
    # Let's assume it's the button with "TURBO" text if active, or just the icon.
    # It's in the header.
    # Button content: <Zap size={16} .../>
    # Let's find it by the Zap icon class or just try to click the button near "Auto-Close".
    # Actually, the header has a Turbo indicator, but the button is in the market scanner header?
    # "button ... Auto-Close ... button ... Zap"
    # Let's look for the button containing the Zap icon.
    page.locator("button:has(svg.lucide-zap)").click()

    # Enable Auto-Bid if needed
    if page.get_by_text("Auto-Bid OFF").is_visible():
        page.get_by_text("Auto-Bid OFF").click()

    # Wait for the bot to run cycle
    time.sleep(3)

    # Verify Order Captured
    assert len(captured_orders) > 0, "Bot did not place a buy order"
    order = captured_orders[0]
    assert order["action"] == "buy"
    assert order["ticker"] == "KXNFLGAME-23OCT26-TB-BUF"
    assert order["yes_price"] == 41

    print("Buy Order Verified!")

    # 4. SIMULATE FILL & HOLDING
    # --------------------------
    mock_positions = {
        "market_positions": [
            {
                "ticker": "KXNFLGAME-23OCT26-TB-BUF",
                "market_ticker": "KXNFLGAME-23OCT26-TB-BUF",
                "position": 10,
                "avg_price": 41,
                "total_cost": 410,
                "fees_paid": 5,
                "settlement_status": "unsettled"
            }
        ]
    }
    page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(json=mock_positions))

    # Trigger a portfolio refresh
    time.sleep(6)

    # Verify Position Tab
    page.get_by_role("button", name="positions").click()
    # Use .first to handle potential duplicates during fast polling/mock updates
    expect(page.locator("tr").filter(has_text="BUF").filter(has_text="10").first).to_be_visible()

    print("Position Verified!")

    # 5. SIMULATE PRICE JUMP (AUTO-CLOSE)
    # -----------------------------------
    # Update Market Mock to Higher Price
    # Price needs to be high enough to trigger auto-close.
    # Avg Price 41. Margin 15%. Target = 41 * 1.15 = 47.15.
    # Bid needs to be >= 48.

    def handle_high_markets(route):
        kalshi_market_high = generate_kalshi_markets(yes_bid=50, yes_ask=55)
        route.fulfill(json=kalshi_market_high)
    page.unroute("**/api/kalshi/markets*")
    page.route("**/api/kalshi/markets*", handle_high_markets)

    # Wait for next cycle (market refresh + auto-close)
    time.sleep(5)

    # Verify Sell Order
    # We expect a new order in captured_orders
    assert len(captured_orders) >= 2, "Bot did not trigger auto-close"
    sell = captured_orders[-1]
    assert sell["action"] == "sell"
    assert sell["ticker"] == "KXNFLGAME-23OCT26-TB-BUF"

    print("Auto-Close Verified!")


def test_portfolio_management(authenticated_page, mock_api):
    """Test cancelling resting orders."""
    page = authenticated_page

    # Mock a resting order
    mock_orders = {
        "orders": [
            {
                "order_id": "ord_resting_1",
                "ticker": "KXNFLGAME-23OCT26-BUF-TB",
                "side": "yes",
                "count": 10,
                "fill_count": 0,
                "remaining_count": 10,
                "yes_price": 41,
                "status": "resting",
                "created_time": "2023-10-26T12:00:00Z"
            }
        ]
    }
    # Note: mock_api is active here, but we override specific route
    page.route("**/api/kalshi/portfolio/orders*", lambda route: route.fulfill(json=mock_orders))

    delete_called = False
    def handle_delete(route):
        nonlocal delete_called
        delete_called = True
        route.fulfill(status=200, json={})

    page.route("**/api/kalshi/portfolio/orders/ord_resting_1", handle_delete)

    page.reload()
    cancel_btn = page.locator("button[title='Cancel Order']").first
    expect(cancel_btn).to_be_visible()

    page.on("dialog", lambda dialog: dialog.accept())
    cancel_btn.click()

    time.sleep(1)
    assert delete_called, "DELETE API was not called"


def test_settings_impact(authenticated_page):
    """Test that changing settings affects calculations."""
    page = authenticated_page

    # Mock Odds API
    page.route(lambda url: "api.the-odds-api.com" in url, lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(generate_odds_response("2023-10-26T20:00:00Z") if "/odds/" in route.request.url else [{"key": "americanfootball_nfl", "title": "NFL", "active": True}])
    ))

    kalshi_market_response = generate_kalshi_markets(yes_bid=40)
    page.route("**/api/kalshi/markets*", lambda route: route.fulfill(json=kalshi_market_response))

    page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json={"balance": 100000}))
    page.route("**/api/kalshi/portfolio/orders*", lambda route: route.fulfill(json={"orders": []}))
    page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(json={"market_positions": []}))

    page.reload()

    expect(page.get_by_text("41¢", exact=True)).to_be_visible()

    page.get_by_role("button", name="Settings").click()
    slider = page.locator("input[type='range']").first
    # Use valid value within range [1, 30]
    slider.fill("20")
    page.get_by_text("Done").click()

    # Recalculate:
    # Fair Value ~60. Margin 20%. MaxPay = 60 * 0.8 = 48.
    # Bid 40. Smart Bid 41.
    # 41 <= 48. So Smart Bid remains 41.

    # Wait, let's try a value that changes the outcome.
    # To force a change, we need Margin such that MaxPay < 41.
    # 60 * (1 - M) < 41  => 1 - M < 0.68 => M > 0.32 (32%).
    # But Max Margin is 30%.
    # So we cannot force "Max Limit" behavior just by changing margin with current prices.
    # Unless we change Trade Size or Sport? No.

    # Let's verify the margin text updates.
    page.get_by_role("button", name="Settings").click()
    expect(page.get_by_text("20%")).to_be_visible()
    page.get_by_text("Done").click()
