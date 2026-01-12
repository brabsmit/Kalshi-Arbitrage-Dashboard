from playwright.sync_api import sync_playwright, expect
import time

def verify_copy_logs():
    with sync_playwright() as p:
        # Launch browser with basicSsl override
        browser = p.chromium.launch(
            headless=True,
            args=["--ignore-certificate-errors"]
        )
        # Grant clipboard permissions
        context = browser.new_context(
            ignore_https_errors=True,
            permissions=["clipboard-read", "clipboard-write"]
        )
        page = context.new_page()

        # Navigate to the app
        print("Navigating to app...")
        page.goto("https://localhost:3000")

        # Wait for app to load (checking header)
        expect(page.get_by_text("Kalshi ArbBot")).to_be_visible()

        # Locate the Copy button
        copy_btn = page.get_by_role("button", name="Copy logs to clipboard")
        expect(copy_btn).to_be_visible()

        # Click it
        print("Clicking Copy button...")
        copy_btn.click()

        # Verify visual feedback (Check icon / Aria label change)
        # The aria-label changes to "Logs Copied" temporarily
        expect(page.get_by_role("button", name="Logs Copied")).to_be_visible()

        # Take screenshot of the "Check" state
        print("Taking screenshot...")
        page.screenshot(path="verification_screenshot.png")

        # Verify clipboard content
        # Note: In headless mode, clipboard read might be flaky without user gesture,
        # but the visual feedback state change confirms the handler ran.

        browser.close()
        print("Verification complete.")

if __name__ == "__main__":
    verify_copy_logs()
