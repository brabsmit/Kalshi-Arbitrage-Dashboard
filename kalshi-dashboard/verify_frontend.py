from playwright.sync_api import sync_playwright, expect
import time

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Ignore HTTPS errors because of self-signed cert
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        # Mock window.forge to prevent blocking
        page.add_init_script("""
            window.forge = {
                md: { sha256: { create: () => ({ update: () => {}, digest: () => {} }) } },
                pki: { privateKeyFromPem: () => ({ sign: () => {} }) },
                pss: { create: () => {} },
                mgf: { mgf1: { create: () => {} } },
                util: { encode64: () => 'mock_signature' }
            };
        """)

        print("Navigating to app...")
        # Port changed to 3000 according to logs, and HTTPS is enabled
        page.goto("https://127.0.0.1:3000")

        # Wait for app to load
        print("Waiting for app to load...")
        page.wait_for_selector("text=Kalshi ArbBot", timeout=10000)

        # Check for Market Scanner
        print("Checking Market Scanner...")
        expect(page.get_by_text("Market Scanner")).to_be_visible()

        # Check for "Sports" filter button
        print("Checking Sports Filter...")
        # The button shows "1 Sport" by default if one is selected
        filter_btn = page.locator("button[aria-label='Filter by Sport']")
        expect(filter_btn).to_be_visible()

        # Click the filter button to open dropdown
        print("Opening Filter Dropdown...")
        filter_btn.click()

        # Verify dropdown content (Sports list)
        # Assuming defaults are NFL, NBA, etc.
        # "Available Sports" is the text in the header of the dropdown
        expect(page.get_by_text("Available Sports")).to_be_visible()
        expect(page.get_by_text("Football (NFL)")).to_be_visible()
        expect(page.get_by_text("Basketball (NBA)")).to_be_visible()

        # Take screenshot of the open filter
        print("Taking screenshot...")
        page.screenshot(path="verification_screenshot.png")

        # Close browser
        browser.close()
        print("Verification complete.")

if __name__ == "__main__":
    verify_frontend()
