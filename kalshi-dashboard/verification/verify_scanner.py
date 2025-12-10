from playwright.sync_api import sync_playwright
import time
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Inject real keys into localStorage
        key_id = os.environ.get("KALSHI_DEMO_API_KEY_ID")
        private_key = os.environ.get("KALSHI_DEMO_API_KEY")
        odds_key = os.environ.get("THE_ODDS_API_KEY", "mock_odds_key")

        # Clean up double pasted keys if detected (same logic as conftest)
        if len(odds_key) == 64 and odds_key[:32] == odds_key[32:]:
            odds_key = odds_key[:32]

        page.goto("http://localhost:3000")

        private_key_js = private_key.replace('\n', '\\n')

        page.evaluate(f"""() => {{
            localStorage.setItem('kalshi_keys', JSON.stringify({{
                keyId: '{key_id}',
                privateKey: `{private_key_js}`
            }}));
            localStorage.setItem('odds_api_key', '{odds_key}');
        }}""")

        page.reload()

        print("Waiting for wallet connection...")
        try:
            page.locator("text=Wallet Active").wait_for(timeout=10000)
            print("Wallet connected.")
        except:
            print("Wallet failed to connect (UI check).")

        print("Opening Sports Dropdown...")
        try:
            page.get_by_text("Select Sports").click()
        except:
             page.locator("button:has-text('Sport')").first.click()

        # Select multiple sports
        sports = ["Basketball (NBA)", "Hockey (NHL)", "Basketball (NCAAB)"]
        for sport in sports:
            try:
                if page.get_by_text(sport).is_visible():
                    page.get_by_text(sport).click()
                    time.sleep(0.2)
            except:
                pass

        # Close dropdown
        page.get_by_text("Kalshi ArbBot").click()

        print("Waiting for markets...")
        # Wait until "Loading Markets..." is gone
        try:
            page.locator("text=Loading Markets...").wait_for(state="hidden", timeout=20000)
            print("Markets loaded.")
        except:
            print("Markets failed to load or took too long.")

        # Take screenshot
        screenshot_path = "kalshi-dashboard/verification/scanner_verification.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        browser.close()

if __name__ == "__main__":
    run()
