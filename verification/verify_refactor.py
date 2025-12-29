from playwright.sync_api import sync_playwright

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--ignore-certificate-errors'])
        page = browser.new_page()
        try:
            print("Navigating to app...")
            page.goto("https://localhost:3000")
            page.wait_for_load_state("networkidle")

            print("Checking Market Scanner...")
            page.locator("text=Market Scanner").wait_for(state="visible", timeout=10000)

            print("Checking Sports Filter...")
            # Verify the SportFilter is visible and interactive
            filter_btn = page.get_by_role("button", name="Filter by Sport")
            if not filter_btn.is_visible():
                # Fallback selector if aria-label matches partial text
                filter_btn = page.locator("button:has-text('Sport')").first

            filter_btn.wait_for()

            print("Taking screenshot...")
            page.screenshot(path="verification/verification.png")
            print("Verification complete.")
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_frontend()
