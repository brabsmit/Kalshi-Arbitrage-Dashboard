import re
from playwright.sync_api import sync_playwright

def verify_table_columns():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use ignore_https_errors because we are using a self-signed cert in dev
        context = browser.new_context(ignore_https_errors=True)

        # Inject mock session data to bypass authentication and populate tables
        # Also inject 'authenticated': 'true' into sessionStorage to bypass PasswordAuth
        context.add_init_script("""
            localStorage.setItem('kalshi_trade_history', JSON.stringify({
                'KXTEST-24JAN20-TEST': {
                    'event': 'Test Event',
                    'source': 'auto',
                    'fairValue': 50,
                    'orderPlacedAt': Date.now() - 3600000,
                    'bidPrice': 45
                }
            }));
            sessionStorage.setItem('kalshi_keys', JSON.stringify({
                'keyId': 'mock_key',
                'privateKey': 'mock_key'
            }));
            sessionStorage.setItem('authenticated', 'true');
        """)

        page = context.new_page()
        page.goto("https://localhost:3000/")

        # Wait for dashboard to load (look for specific dashboard element like "Kalshi ArbBot")
        try:
            page.wait_for_selector('h1:has-text("Kalshi ArbBot")', timeout=15000)
        except:
            print("Dashboard did not load. Check screenshots.")
            page.screenshot(path="verification/dashboard_failed.png")
            browser.close()
            return

        # Take a screenshot of the initial state
        page.screenshot(path="verification/dashboard_initial.png")

        # Switch to Positions Tab
        print("Clicking POSITIONS tab...")
        try:
            page.locator("#tab-positions").click(timeout=5000, force=True)
        except Exception as e:
            print(f"Failed to click positions by ID: {e}")

        page.wait_for_timeout(1000) # Wait for render
        page.screenshot(path="verification/dashboard_positions.png")

        headers = page.locator("div[role='tabpanel'] table thead tr th button span:first-child").all_inner_texts()
        headers = [h for h in headers if h.strip()]
        print(f"Positions Headers: {headers}")

        print("Clicking RESTING tab...")
        try:
            page.locator("#tab-resting").click(timeout=5000, force=True)
        except Exception as e:
            print(f"Failed to click resting by ID: {e}")

        page.wait_for_timeout(1000)
        page.screenshot(path="verification/dashboard_resting.png")
        headers = page.locator("div[role='tabpanel'] table thead tr th button span:first-child").all_inner_texts()
        headers = [h for h in headers if h.strip()]
        print(f"Resting Headers: {headers}")

        print("Clicking HISTORY tab...")
        try:
            page.locator("#tab-history").click(timeout=5000, force=True)
        except Exception as e:
            print(f"Failed to click history by ID: {e}")

        page.wait_for_timeout(1000)
        page.screenshot(path="verification/dashboard_history.png")
        headers = page.locator("div[role='tabpanel'] table thead tr th button span:first-child").all_inner_texts()
        headers = [h for h in headers if h.strip()]
        print(f"History Headers: {headers}")

        browser.close()

if __name__ == "__main__":
    verify_table_columns()
