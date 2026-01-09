from playwright.sync_api import sync_playwright

def verify_copy_logs_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Create a new context with ignored HTTPS errors
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        try:
            print("Navigating to dashboard...")
            page.goto("https://localhost:3000")

            # Wait for the dashboard to load (look for the Header)
            page.wait_for_selector("text=Kalshi ArbBot")

            # Locate Event Log header
            print("Locating Event Log...")
            event_log = page.get_by_text("Event Log", exact=False)
            event_log.scroll_into_view_if_needed()

            # Locate the Copy Button
            print("Locating Copy Button...")
            copy_button = page.get_by_role("button", name="Copy logs to clipboard")

            if copy_button.is_visible():
                print("SUCCESS: Copy button is visible.")

                # Take a screenshot of the Event Log area
                # We can try to screenshot just the Event Log container if possible,
                # or the whole page.
                # Let's find the container. It's the parent div of the header.
                container = copy_button.locator("xpath=../..")
                container.screenshot(path="verification/copy_logs_ui.png")
                print("Screenshot saved to verification/copy_logs_ui.png")

                # Test interaction (click)
                print("Clicking Copy Button...")
                copy_button.click()

                # Check for visual feedback (Check icon should appear)
                # We wait a bit for React to update
                page.wait_for_timeout(200)

                # After click, the icon inside button should change.
                # We can take another screenshot or just rely on the script not failing.
                container.screenshot(path="verification/copy_logs_clicked.png")
                print("Clicked screenshot saved.")

            else:
                print("FAILURE: Copy button not visible.")

        except Exception as e:
            print(f"An error occurred: {e}")
            page.screenshot(path="verification/error_screenshot.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_copy_logs_ui()
