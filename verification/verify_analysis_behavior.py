
import pytest
from playwright.sync_api import sync_playwright, expect
import json
import time

def test_analysis_modal_behavior():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True)

        # Inject auth and trade history
        trade_history = {
            "KX-TEST-23DEC31": {
                "source": "auto",
                "fairValue": 60,
                "orderPlacedAt": 1701432000000,
                "event": "Test Event",
                "marketId": "KX-TEST-23DEC31"
            },
            "KX-TEST-POS-23DEC31": {
                "source": "auto",
                "fairValue": 60,
                "orderPlacedAt": 1701432000000,
                "event": "Test Position Event",
                "marketId": "KX-TEST-POS-23DEC31"
            }
        }

        context.add_init_script(f"""
            window.localStorage.setItem('kalshi_keys', JSON.stringify({{
                keyId: 'test-key',
                privateKey: 'test-key'
            }}));
            window.sessionStorage.setItem('authenticated', 'true');
            window.localStorage.setItem('odds_api_key', 'test-odds-key');
            window.localStorage.setItem('kalshi_trade_history', JSON.stringify({json.dumps(trade_history)}));
        """)

        page = context.new_page()

        # Mock API responses - Match the actual URLs requested by the browser
        page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json={"balance": 100000}))
        page.route("**/api/kalshi/portfolio/orders", lambda route: route.fulfill(json={
            "orders": [
                {
                    "order_id": "order-1",
                    "ticker": "KX-TEST-23DEC31",
                    "action": "buy",
                    "side": "yes",
                    "count": 10,
                    "fill_count": 0,
                    "remaining_count": 10,
                    "yes_price": 50,
                    "status": "active",
                    "created_time": "2023-12-01T12:00:00Z",
                    "expiration_time": "2023-12-02T12:00:00Z"
                }
            ]
        }))
        page.route("**/api/kalshi/portfolio/positions", lambda route: route.fulfill(json={
            "market_positions": [
                {
                    "ticker": "KX-TEST-POS-23DEC31",
                    "position": 10,
                    "total_cost": 500,
                    "fees_paid": 10,
                    "avg_price": 50,
                    "realized_pnl": 0,
                    "settlement_status": "unsettled"
                }
            ]
        }))
        page.route("**/api/kalshi/portfolio/positions?settlement_status=settled", lambda route: route.fulfill(json={"market_positions": []}))

        # Mock markets
        page.route("**/api/kalshi/markets**", lambda route: route.fulfill(json={"markets": [
            {"ticker": "KX-TEST-23DEC31", "yes_bid": 55, "yes_ask": 60},
            {"ticker": "KX-TEST-POS-23DEC31", "yes_bid": 55, "yes_ask": 60}
        ]}))

        # Mock Odds API
        page.route("https://api.the-odds-api.com/v4/sports/**", lambda route: route.fulfill(json=[]))

        page.goto("https://127.0.0.1:3000")

        # Wait for portfolio to load
        page.wait_for_selector("text=Market Scanner")

        # --- Test 1: Resting Order ---
        print("Switching to Resting tab...")
        page.click("button:has-text('Resting')")
        page.wait_for_timeout(1000)

        # The row for resting order
        resting_row = page.locator("tr").filter(has_text="KX-TEST-23DEC31")
        count = resting_row.count()
        print(f"Found {count} resting rows")

        if count > 0:
            btn = resting_row.locator("button[aria-label='Trade Analysis']")
            # Force click even if Playwright thinks it's not actionable (though it should be)
            btn.click(force=True)

            expect(page.locator("text=Trade Analysis")).to_be_visible()

            sell_btn = page.locator("button:has-text('Sell at Market')")
            if sell_btn.is_visible():
                print("Current Behavior: 'Sell at Market' is visible for resting orders (To be fixed)")
            else:
                print("Current Behavior: 'Sell at Market' is NOT visible for resting orders")

            page.click("button[aria-label='Close']")
        else:
            print("Row not found!")

        # --- Test 2: Held Position ---
        print("Switching to Positions tab...")
        page.click("button:has-text('Positions')")
        page.wait_for_timeout(1000)

        pos_row = page.locator("tr").filter(has_text="KX-TEST-POS-23DEC31")
        if pos_row.count() > 0:
            btn = pos_row.locator("button[aria-label='Trade Analysis']")
            btn.click(force=True)

            expect(page.locator("button:has-text('Sell at Market')")).to_be_visible()
            print("Verified: 'Sell at Market' is visible for held positions")

            # Check modal structure
            modal_div = page.locator("div.bg-white.rounded-xl.shadow-2xl.w-full.max-w-lg")
            print(f"Modal classes: {modal_div.get_attribute('class')}")

        else:
            print("Position row not found")

        browser.close()

if __name__ == "__main__":
    test_analysis_modal_behavior()
