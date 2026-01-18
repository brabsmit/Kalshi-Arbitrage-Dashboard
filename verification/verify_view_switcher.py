from playwright.sync_api import sync_playwright, expect
import time

def verify_market_scanner_switcher():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Grant permissions for clipboard if needed, though not strictly required here
        # ignore_https_errors=True is CRITICAL for vite-plugin-basic-ssl
        context = browser.new_context(
            permissions=['clipboard-read', 'clipboard-write'],
            ignore_https_errors=True
        )

        # Inject API keys to bypass login (as per memory instructions)
        context.add_init_script("""
            localStorage.setItem('kalshi_keys', JSON.stringify({
                keyId: 'test-key-id',
                privateKey: 'test-private-key'
            }));
            sessionStorage.setItem('authenticated', 'true');
            sessionStorage.setItem('odds_api_key', 'test-odds-key');
        """)

        page = context.new_page()

        # Go to app (assuming it's running on port 3000 as per memory)
        # Using 127.0.0.1 to avoid connection refused
        try:
            # Use https because vite-plugin-basic-ssl is used
            page.goto("https://127.0.0.1:3000", timeout=60000)
        except Exception as e:
            print(f"Failed to load page: {e}")
            return

        # Wait for the app to load
        # Check for Market Scanner header
        try:
            expect(page.get_by_text("Market Scanner")).to_be_visible(timeout=30000)
        except:
            print("Market Scanner header not found. Taking screenshot of error state.")
            page.screenshot(path="verification/error_state.png")
            return

        # Verify the MarketTypeSelector is present
        # It should have buttons: Moneyline, Spreads, Totals
        moneyline_btn = page.get_by_role("button", name="Moneyline")
        spreads_btn = page.get_by_role("button", name="Spreads")
        totals_btn = page.get_by_role("button", name="Totals")

        if moneyline_btn.is_visible() and spreads_btn.is_visible() and totals_btn.is_visible():
            print("MarketTypeSelector buttons visible.")
        else:
            print("MarketTypeSelector buttons MISSING.")

        # Take screenshot of the initial state (Moneyline selected)
        page.screenshot(path="verification/market_scanner_moneyline.png")
        print("Screenshot saved: verification/market_scanner_moneyline.png")

        # Click Spreads
        spreads_btn.click()
        time.sleep(1) # Wait for UI update
        page.screenshot(path="verification/market_scanner_spreads.png")
        print("Screenshot saved: verification/market_scanner_spreads.png")

        # Click Totals
        totals_btn.click()
        time.sleep(1) # Wait for UI update
        page.screenshot(path="verification/market_scanner_totals.png")
        print("Screenshot saved: verification/market_scanner_totals.png")

        browser.close()

if __name__ == "__main__":
    verify_market_scanner_switcher()
