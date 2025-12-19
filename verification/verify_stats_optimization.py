import os
import time
from playwright.sync_api import sync_playwright, expect

def verify_stats_banner():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        # Mock window.forge
        page.add_init_script("""
            window.forge = {
                pki: {
                    privateKeyFromPem: () => ({ sign: () => 'sig' }),
                    privateKeyToAsn1: () => ({}),
                    wrapRsaPrivateKey: () => ({}),
                },
                md: { sha256: { create: () => ({ update: () => {} }) } },
                pss: { create: () => {} },
                mgf: { mgf1: { create: () => {} } },
                asn1: { toDer: () => ({ getBytes: () => [] }) },
                util: { encode64: () => 'sig' }
            };
            if (!window.crypto) window.crypto = {};
            if (!window.crypto.subtle) window.crypto.subtle = {
                importKey: async () => ({}),
                sign: async () => new ArrayBuffer(10)
            };
        """)

        # Navigate
        page.goto("https://localhost:3000")

        # Click Start
        start_btn = page.get_by_role("button", name="Start")
        start_btn.click()

        # Wait for 3 seconds
        time.sleep(3)

        # Find the card that contains "Session Time"
        # The card has classes "bg-white p-4 rounded-xl ..."
        # We can find all cards and filter by text

        card = page.locator("div.bg-white.rounded-xl").filter(has_text="Session Time").first

        # Find the value div inside the card
        value_div = card.locator(".text-2xl")

        # Expect value to be e.g. "3s"
        try:
            text = value_div.inner_text(timeout=5000)
            print(f"Timer value: {text}")

            if text == "0s":
                print("Timer did not update!")
            else:
                print("Timer is updating.")
        except Exception as e:
            print(f"Failed to find timer text: {e}")
            # print page content
            # print(page.content())

        if not os.path.exists("verification"):
            os.makedirs("verification")
        page.screenshot(path="verification/stats_banner_optimized.png")
        print("Screenshot saved.")

        browser.close()

if __name__ == "__main__":
    verify_stats_banner()
