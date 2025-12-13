from playwright.sync_api import sync_playwright
import time
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Set up mocks for localStorage to enable auto-close and auto-bid
        # Also need to mock 'kalshi_keys' to enable 'authenticated' state
        page.add_init_script("""
            localStorage.setItem('kalshi_config', JSON.stringify({
                isAutoClose: true,
                isAutoBid: true,
                selectedSports: ['americanfootball_nfl'],
                marginPercent: 10,
                autoCloseMarginPercent: 10,
                tradeSize: 10,
                maxPositions: 5
            }));
            localStorage.setItem('kalshi_keys', JSON.stringify({
                keyId: 'test_key',
                privateKey: 'test_key'
            }));
            // Mock window.forge to avoid loading error
            window.forge = {
                pki: {
                    privateKeyFromPem: () => ({ sign: () => 'sig' }),
                    privateKeyToAsn1: () => ({}),
                    wrapRsaPrivateKey: () => ({}),
                },
                asn1: { toDer: () => ({ getBytes: () => '' }) },
                md: { sha256: { create: () => ({ update: () => {} }) } },
                pss: { create: () => {} },
                mgf: { mgf1: { create: () => {} } },
                util: { encode64: () => 'sig' }
            };
            // Mock Crypto API
            window.crypto.subtle = {
                importKey: async () => 'key',
                sign: async () => new Uint8Array([1,2,3])
            };
        """)

        # Go to app
        page.goto("http://localhost:3000")

        # Wait for app to load
        page.wait_for_selector("text=Kalshi ArbBot")

        # Start the bot
        start_button = page.get_by_role("button", name="Start")
        if start_button.is_visible():
            start_button.click()

        time.sleep(2) # Wait for initial effects

        # Take screenshot of the dashboard running with Auto-Close ON
        if not os.path.exists("verification"):
            os.makedirs("verification")

        page.screenshot(path="verification/dashboard_auto_close.png")
        browser.close()

if __name__ == "__main__":
    run()
