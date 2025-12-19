from playwright.sync_api import sync_playwright, expect
import time

def verify_stats_banner(page):
    # Mock localStorage to set API keys so we don't get stuck in "Connect Wallet"
    page.goto("https://localhost:3000")

    page.evaluate("""() => {
        localStorage.setItem('kalshi_keys', JSON.stringify({
            keyId: 'test_key',
            privateKey: 'test_key_pem'
        }));
        localStorage.setItem('odds_api_key', 'test_odds_key');

        // Mock forge to prevent loading screen
        window.forge = {
            pki: { privateKeyFromPem: () => ({ sign: () => 'sig' }), privateKeyToAsn1: () => {}, wrapRsaPrivateKey: () => {} },
            asn1: { toDer: () => ({ getBytes: () => 'bytes' }) },
            md: { sha256: { create: () => ({ update: () => {} }) } },
            pss: { create: () => {} },
            mgf: { mgf1: { create: () => {} } },
            util: { encode64: () => 'sig' }
        };
    }""")

    page.reload()

    # Wait for dashboard to load
    expect(page.get_by_text("Kalshi ArbBot")).to_be_visible()

    # Check Stats Banner presence
    expect(page.get_by_text("Statistical Sig.")).to_be_visible()

    # Check initial session time is 0s
    session_label = page.get_by_text("Session Time")
    session_value = session_label.locator("..").locator(".text-2xl")
    expect(session_value).to_contain_text("0s")

    # Start the bot
    start_btn = page.get_by_role("button", name="Start")
    start_btn.click()

    # Wait for session time to update
    time.sleep(2.5)

    # Take screenshot
    page.screenshot(path="verification/stats_banner.png")

    # Verify time updated (e.g. 2.5s -> 2.5s formatted)
    # The format is "2.5s"
    val = session_value.text_content()
    print(f"Session Time: {val}")

    if val == "0s" or val == "-":
        raise Exception("Session time did not update!")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Enable ignore_https_errors
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()
        try:
            verify_stats_banner(page)
        finally:
            browser.close()
