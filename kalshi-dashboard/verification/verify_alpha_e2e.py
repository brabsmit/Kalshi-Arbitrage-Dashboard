
import pytest
from playwright.sync_api import Page, expect, BrowserContext
import json
import time

@pytest.fixture(scope="function")
def context(browser):
    context = browser.new_context(ignore_https_errors=True)
    yield context
    context.close()

@pytest.fixture(scope="function")
def page(context):
    page = context.new_page()
    yield page
    page.close()

def test_alpha_volatility_impact(page: Page):
    page.on("console", lambda msg: print(f"BROWSER LOG: {msg.text}"))
    page.on("pageerror", lambda err: print(f"BROWSER ERROR: {err}"))

    # Mock The Odds API to simulate volatility
    # We will serve 3 responses sequentially to build a history

    # Response 1: Price implies 50%
    r1 = [{
        "id": "game1",
        "sport_key": "americanfootball_nfl",
        "commence_time": "2024-12-01T20:00:00Z",
        "home_team": "TeamA",
        "away_team": "TeamB",
        "bookmakers": [{
            "key": "b1", "title": "B1", "last_update": "2024-12-01T10:00:00Z",
            "markets": [{"key": "h2h", "outcomes": [{"name": "TeamA", "price": -100}, {"name": "TeamB", "price": -100}]}]
        }]
    }] # Prob 0.50

    # Response 2: Price implies 60%
    r2 = [{
        "id": "game1",
        "sport_key": "americanfootball_nfl",
        "commence_time": "2024-12-01T20:00:00Z",
        "home_team": "TeamA",
        "away_team": "TeamB",
        "bookmakers": [{
            "key": "b1", "title": "B1", "last_update": "2024-12-01T10:00:05Z",
            "markets": [{"key": "h2h", "outcomes": [{"name": "TeamA", "price": -150}, {"name": "TeamB", "price": 130}]}]
        }]
    }] # Prob 0.60

    # Response 3: Price implies 40%
    r3 = [{
        "id": "game1",
        "sport_key": "americanfootball_nfl",
        "commence_time": "2024-12-01T20:00:00Z",
        "home_team": "TeamA",
        "away_team": "TeamB",
        "bookmakers": [{
            "key": "b1", "title": "B1", "last_update": "2024-12-01T10:00:10Z",
            "markets": [{"key": "h2h", "outcomes": [{"name": "TeamA", "price": 150}, {"name": "TeamB", "price": -170}]}]
        }]
    }] # Prob 0.40

    # Mock Kalshi (always found)
    page.route("**/api/kalshi/markets*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({"markets": [{
            "ticker": "KXNCAAF-GAME1",
            "event_ticker": "KXNCAAF-GAME1",
            "market_type": "winner",
            "yes_bid": 10,
            "yes_ask": 90,
            "open_interest": 100,
            "volume": 1000
        }]})
    ))

    # Setup Odds API Mock with counter
    call_count = 0
    def handle_odds(route):
        nonlocal call_count
        call_count += 1
        print(f"Odds API Call #{call_count}")
        if call_count == 1:
            route.fulfill(json=r1)
        elif call_count == 2:
            route.fulfill(json=r2)
        else:
            route.fulfill(json=r3)

    page.route("**/sports/*/odds/*", handle_odds)

    # Mock Portfolio (Empty)
    page.route("**/portfolio/balance", lambda r: r.fulfill(json={"balance": 100000}))
    page.route("**/portfolio/orders", lambda r: r.fulfill(json={"orders": []}))
    page.route("**/portfolio/positions", lambda r: r.fulfill(json={"market_positions": []}))

    # Go
    page.goto("https://localhost:3000")
    page.wait_for_selector("text=Connect Wallet")

    # Connect Wallet (Mock)
    page.click("text=Connect Wallet")
    page.wait_for_selector("#api-key-id")
    page.fill("#api-key-id", "test_key")
    # Upload mock key
    with open("kalshi-dashboard/verification/test_private.pem", "w") as f:
        f.write("-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ...\n-----END PRIVATE KEY-----")

    page.set_input_files("#private-key-upload", "kalshi-dashboard/verification/test_private.pem")
    # Click the Connect button inside the modal specifically
    page.click("div[role='dialog'] button:has-text('Connect')")

    # Enable Turbo Mode to speed up polling
    page.click("button[title='Turbo Mode (3s updates)']")

    # Wait for 3 updates to happen (approx 9-10 seconds)
    print("Waiting for polling cycles to build history...")
    page.wait_for_timeout(10000)

    # Now verify the table row for "TeamA vs TeamB"
    row = page.locator("tr", has_text="TeamA vs TeamB")
    expect(row).to_be_visible()

    # Get Volatility Cell (3rd data column?)
    # Layout: Checkbox | Event | FairValue | Volatility | Bid/Ask | Max Limit | Smart Bid | Action
    # Indices: 0         1       2           3            4          5           6           7

    vol_cell = row.locator("td").nth(3)
    max_limit_cell = row.locator("td").nth(5)

    vol_text = vol_cell.inner_text().strip()
    print(f"Volatility Displayed: {vol_text}")

    # Assert Volatility is > 0 (it should be roughly 10 if prices were 50, 60, 40)
    assert float(vol_text) > 5.0, f"Expected volatility > 5.0, got {vol_text}"

    # Calculate Expected Max Limit
    # Current Prob (r3) is 40%. FairValue = 40.
    # Margin = 15% (default)
    # Volatility = ~10 (StdDev of 50, 60, 40)
    # Effective Margin = 15 + 10 = 25%
    # Max Willing = 40 * (1 - 0.25) = 30

    # Without Vol adjustment: Max Willing = 40 * (1 - 0.15) = 34

    max_limit_text = max_limit_cell.inner_text().replace('¢', '').strip()
    print(f"Max Limit Displayed: {max_limit_text}")

    assert int(max_limit_text) <= 32, f"Expected Max Limit to be impacted by volatility (<= 32), got {max_limit_text}"

    print("SUCCESS: Volatility calculation and impact verified in E2E test.")
