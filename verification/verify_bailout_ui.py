import time
from playwright.sync_api import sync_playwright, expect

def verify_bailout_settings():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--ignore-certificate-errors'])
        context = browser.new_context(ignore_https_errors=True)

        # Bypass Authentication
        context.add_init_script("""
            window.sessionStorage.setItem('authenticated', 'true');
            window.localStorage.setItem('odds_api_key', 'test_key');
        """)

        page = context.new_page()
        page.goto("https://127.0.0.1:3000")

        # Open Settings
        print("Opening Settings...")
        page.get_by_label("Settings").click()

        expect(page.get_by_text("Bot Configuration")).to_be_visible()

        # Scroll down to Bail Out section
        bailout_header = page.get_by_text("Bail Out (Stop Loss)")
        bailout_header.scroll_into_view_if_needed()
        expect(bailout_header).to_be_visible()

        print("Enabling Bail Out...")

        # Toggle Checkbox
        toggle = page.locator("#enable-bailout")
        if not toggle.is_checked():
            toggle.check()
            print("Checked Bail Out toggle.")

        # Verify sub-settings appear
        expect(page.get_by_text("Trigger Window")).to_be_visible()
        expect(page.get_by_text("Loss Trigger %")).to_be_visible()

        print("Adjusting settings...")

        # Adjust Hours
        hours_input = page.locator("#bailout-hours-input")
        hours_input.fill("12")

        # Adjust Trigger
        trigger_input = page.locator("#bailout-percent-input")
        trigger_input.fill("25")

        # Take Screenshot
        print("Taking screenshot...")
        page.screenshot(path="verification_screenshot.png")
        print("Screenshot saved to verification_screenshot.png")

        browser.close()

if __name__ == "__main__":
    verify_bailout_settings()
