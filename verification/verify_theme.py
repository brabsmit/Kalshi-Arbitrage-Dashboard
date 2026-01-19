from playwright.sync_api import sync_playwright
import time

def test_dark_mode():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Ignore HTTPS errors because the dev server uses a basic SSL plugin
        context = browser.new_context(ignore_https_errors=True)

        # Inject authentication to bypass PasswordAuth
        context.add_init_script("""
            sessionStorage.setItem('authenticated', 'true');
            sessionStorage.setItem('odds_api_key', 'test_key');
        """)

        page = context.new_page()

        # Navigate to the dashboard
        page.goto("https://localhost:3000/")

        # Wait for the page to load
        try:
            page.wait_for_selector("text=Kalshi ArbBot", timeout=10000)
        except:
            # Fallback if text is split
            print("Could not find 'Kalshi ArbBot', trying generic header")
            page.wait_for_selector("header", timeout=10000)

        # Take a screenshot of the initial (likely auto/light) state
        page.screenshot(path="verification/before_theme_change.png")

        # Open Settings Modal
        page.get_by_role("button", name="Settings").click()
        time.sleep(1) # Animation wait

        # Verify Settings Modal is open
        if not page.is_visible("text=Bot Configuration"):
            print("Settings modal did not open")
            # Debug screenshot
            page.screenshot(path="verification/debug_modal_failed.png")
            browser.close()
            return

        # Locate Theme buttons
        # Click "Dark" mode
        dark_btn = page.get_by_role("button", name="dark")
        if not dark_btn.is_visible():
             print("Dark button not found!")
             page.screenshot(path="verification/debug_no_dark_btn.png")
             browser.close()
             return

        dark_btn.click()
        time.sleep(1) # Wait for transition

        # Take screenshot of Settings Modal in Dark Mode
        page.screenshot(path="verification/settings_dark_mode.png")

        # Close Settings Modal
        page.get_by_role("button", name="Done").click()
        time.sleep(1)

        # Take screenshot of Dashboard in Dark Mode
        page.screenshot(path="verification/dashboard_dark_mode.png")

        # Verify dark class is on html element
        is_dark = page.evaluate("document.documentElement.classList.contains('dark')")
        print(f"Dark mode active: {is_dark}")

        # Open Settings again and switch to Light
        page.get_by_role("button", name="Settings").click()
        time.sleep(1)
        page.get_by_role("button", name="light").click()
        time.sleep(1)

        # Take screenshot of Light Mode
        page.screenshot(path="verification/dashboard_light_mode.png")

        is_dark = page.evaluate("document.documentElement.classList.contains('dark')")
        print(f"Dark mode active (should be False): {is_dark}")

        browser.close()

if __name__ == "__main__":
    test_dark_mode()
