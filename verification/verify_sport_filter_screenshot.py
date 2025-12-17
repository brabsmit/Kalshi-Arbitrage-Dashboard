
import time
from playwright.sync_api import sync_playwright

def verify_and_screenshot():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        url = "https://localhost:3001"
        try:
            print(f"Navigating to {url}")
            page.goto(url)
            page.wait_for_selector("header", timeout=30000)
        except Exception:
            print("Retrying on port 3000...")
            url = "https://localhost:3000"
            page.goto(url)
            page.wait_for_selector("header", timeout=30000)

        try:
            # Locate the Sport Filter button
            filter_btn = page.locator("button:has-text('Sport')").first
            if not filter_btn.is_visible():
                filter_btn = page.locator("button:has(svg.lucide-trophy)")

            filter_btn.wait_for(state="visible", timeout=10000)

            # Click to open dropdown
            filter_btn.click()
            time.sleep(1) # Wait for animation

            # Take screenshot
            screenshot_path = "verification/sport_filter_dropdown.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

            return screenshot_path

        except Exception as e:
            print(f"ERROR: {e}")
            return None
        finally:
            browser.close()

if __name__ == "__main__":
    path = verify_and_screenshot()
    if not path:
        exit(1)
