from playwright.sync_api import sync_playwright, expect
import json
import time

def verify_palette_ux():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        # Mock API
        page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json={"balance": 100000}))
        page.route("**/api/kalshi/markets*", lambda route: route.fulfill(json={"markets": []}))
        page.route("**/api/kalshi/portfolio/orders*", lambda route: route.fulfill(json={"orders": []}))
        page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(json={"market_positions": []}))

        # Inject credentials
        page.goto("https://localhost:3000")
        page.evaluate("""() => {
            localStorage.setItem('kalshi_keys', JSON.stringify({
                keyId: 'test_key',
                privateKey: 'test_key'
            }));
        }""")
        page.reload()

        # 1. Verify Event Log Copy Button
        print("Verifying Event Log Copy Button...")
        expect(page.get_by_text("Event Log")).to_be_visible()
        copy_btn = page.get_by_label("Copy Logs")
        expect(copy_btn).to_be_visible()

        # Focus the button to show focus ring (if visible)
        copy_btn.focus()

        # Take Screenshot
        print("Taking screenshot...")
        page.screenshot(path="verification/verification.png")
        print("Screenshot saved to verification/verification.png")

        browser.close()

if __name__ == "__main__":
    verify_palette_ux()
