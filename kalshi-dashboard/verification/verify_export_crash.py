
import os
import time
from playwright.sync_api import sync_playwright

def verify_export_modal_crash_fix():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--ignore-certificate-errors'])
        page = browser.new_page(ignore_https_errors=True)

        # Inject mock forge since we aren't connecting wallet but might need it
        page.add_init_script("""
            window.forge = {
                pki: { privateKeyFromPem: () => ({ sign: () => 'mock_sig' }) },
                md: { sha256: { create: () => ({ update: () => {} }) } },
                mgf: { mgf1: { create: () => {} } },
                pss: { create: () => {} },
                util: { encode64: () => 'mock_encoded' }
            };
        """)

        # Go to app
        page.goto("https://localhost:3000")

        # Wait for app to load
        page.wait_for_selector("text=Kalshi ArbBot")

        # Open Export Modal
        # Before the fix, this would crash due to ReferenceError
        print("Clicking Session Reports...")
        page.get_by_role("button", name="Session Reports").click()

        # Wait for modal content
        print("Waiting for Export Modal...")
        page.wait_for_selector("text=Download CSV", timeout=5000)

        # Take screenshot
        os.makedirs("verification", exist_ok=True)
        page.screenshot(path="verification/export_modal_fixed.png")
        print("Screenshot saved to verification/export_modal_fixed.png")

        browser.close()

if __name__ == "__main__":
    verify_export_modal_crash_fix()
