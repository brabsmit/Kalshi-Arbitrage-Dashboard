from playwright.sync_api import sync_playwright

def verify_dashboard():
    with sync_playwright() as p:
        # Launch browser in headless mode
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # Navigate to the dashboard
            page.goto("http://localhost:3000")

            # Wait for the dashboard to load (look for "Kalshi ArbBot")
            page.wait_for_selector("text=Kalshi ArbBot", timeout=10000)

            # Wait for markets to load or "Loading Markets..." to appear
            # We want to see the market scanner table
            page.wait_for_timeout(2000)

            # Take a screenshot
            screenshot_path = "verification/dashboard_loaded.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Error during verification: {e}")
            page.screenshot(path="verification/error_state.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_dashboard()
