from playwright.sync_api import sync_playwright, expect
import time

def verify_forge_loading():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # ignore_https_errors is crucial for localhost https
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        print("Navigating to dashboard...")
        page.goto("https://localhost:3000")

        # 1. Verify App Loads (Header is visible)
        header = page.get_by_text("Kalshi ArbBot")
        expect(header).to_be_visible(timeout=10000)
        print("Header found.")

        # 2. Verify NO Spinner for "Initializing Security Libraries..."
        # We expect this text to NOT be visible.
        # Note: If it flashed very quickly, we might miss it, but since we are verifying the end state...
        # The key is that the app IS loaded.

        spinner_text = page.get_by_text("Initializing Security Libraries...")
        if spinner_text.is_visible():
            print("FAIL: Spinner is still visible!")
            exit(1)
        else:
            print("PASS: Spinner is not visible.")

        # 3. Verify window.forge is defined
        is_forge_defined = page.evaluate("() => typeof window.forge !== 'undefined'")
        if is_forge_defined:
            print("PASS: window.forge is defined.")
        else:
            print("FAIL: window.forge is undefined!")
            exit(1)

        # 4. Take screenshot
        page.screenshot(path="verification/forge_verification.png")
        print("Screenshot saved.")

        browser.close()

if __name__ == "__main__":
    verify_forge_loading()
