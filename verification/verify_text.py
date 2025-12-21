from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()
        print("Navigating...")
        try:
            page.goto("https://localhost:3000", timeout=30000)
        except Exception as e:
            print(f"Error navigating: {e}")

        print("Waiting for app...")
        page.wait_for_selector("text=Kalshi ArbBot")

        print("Opening modal...")
        page.click("button:has-text('Connect Wallet')")

        print("Taking screenshot...")
        page.wait_for_selector("text=Keys stored in session memory")
        page.screenshot(path="verification/connect_modal.png")
        browser.close()

if __name__ == "__main__":
    run()
