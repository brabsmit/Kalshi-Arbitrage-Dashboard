from playwright.sync_api import sync_playwright, expect
import os

def verify_palette_changes():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Ignore HTTPS errors because of self-signed cert
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        # Inject Mock Credentials to pass Auth check
        # We need to set localStorage before loading the app fully
        page.goto("https://localhost:3000")

        # 1. Screenshot Scanner Toolbar
        expect(page.get_by_text("Market Scanner")).to_be_visible()
        # Wait for the toolbar buttons to be visible
        expect(page.get_by_label("Toggle Turbo Mode")).to_be_visible()

        page.screenshot(path="verification/scanner_toolbar.png")
        print("Screenshot saved to verification/scanner_toolbar.png")

        # 2. Screenshot Settings Modal
        page.get_by_label("Settings").click()
        expect(page.get_by_text("Bot Configuration")).to_be_visible()
        # Wait for inputs
        expect(page.get_by_label("Auto-Bid Margin")).to_be_visible()

        page.screenshot(path="verification/settings_modal.png")
        print("Screenshot saved to verification/settings_modal.png")

        browser.close()

if __name__ == "__main__":
    if not os.path.exists("verification"):
        os.makedirs("verification")
    verify_palette_changes()
