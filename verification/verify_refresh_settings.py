import re
from playwright.sync_api import sync_playwright, expect
import time
import os
import json

def verify_refresh_settings():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--ignore-certificate-errors",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu"
            ]
        )
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        try:
            # Inject authenticated status to bypass auth
            context.add_init_script("""
                sessionStorage.setItem('authenticated', 'true');
                sessionStorage.setItem('odds_api_key', 'test_key');
                sessionStorage.setItem('kalshi_keys', JSON.stringify({keyId: 'test', privateKey: 'test'}));
                localStorage.setItem('kalshi_config', JSON.stringify({
                    isTurboMode: false,
                    refreshInterval: 15,
                    selectedSports: ['americanfootball_nfl']
                }));
            """)

            print("Navigating to https://127.0.0.1:3000 ...")
            page.goto("https://127.0.0.1:3000")

            # Wait for main content
            expect(page.get_by_role("heading", name="Kalshi ArbBot")).to_be_visible(timeout=15000)

            # 1. Verify "15s" text
            print("Verifying 15s display...")
            expect(page.get_by_text(re.compile(r"Next scan in 15s"))).to_be_visible()

            # 2. Open Settings
            print("Opening Settings...")
            page.get_by_role("button", name="Settings").click()
            expect(page.get_by_role("heading", name="Bot Configuration")).to_be_visible()

            # 3. Change Refresh Rate
            print("Changing Refresh Rate to 30s...")
            refresh_input = page.get_by_role("spinbutton", name="API Refresh Rate")
            refresh_input.fill("30")

            # Close settings
            page.get_by_role("button", name="Done").click()
            expect(page.get_by_role("heading", name="Bot Configuration")).not_to_be_visible()

            # 4. Verify "30s" text
            print("Verifying 30s display...")
            expect(page.get_by_text(re.compile(r"Next scan in 30s"))).to_be_visible()

            # 5. Toggle Turbo Mode
            print("Toggling Turbo Mode...")
            page.get_by_label("Toggle Turbo Mode").click()

            # 6. Verify "3s" text
            print("Verifying 3s display (Turbo)...")
            expect(page.get_by_text(re.compile(r"Next scan in 3s"))).to_be_visible()

            # Screenshot
            if not os.path.exists("verification"):
                os.makedirs("verification")
            page.screenshot(path="verification/refresh_rate_verification.png")
            print("Screenshot saved to verification/refresh_rate_verification.png")

        except Exception as e:
            print(f"Test failed: {e}")
            if not os.path.exists("verification"):
                os.makedirs("verification")
            page.screenshot(path="verification/failure.png")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    verify_refresh_settings()
