
import os
import sys
from playwright.sync_api import sync_playwright, expect

def verify_copy_logs_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a higher viewport to see the EventLog which is at the bottom
        page = browser.new_page(viewport={'width': 1280, 'height': 800})

        # We need to serve the app.
        # Assuming the dev server is running on localhost:3000
        # If not, we might need to rely on static inspection or start it.
        # But for this environment, starting the server is required.

        try:
            # We need to use https and ignore cert errors because the server is using basicSsl
            # We can't easily change the context here, so we should rely on playwright setup
            # But wait, browser.new_page(ignore_https_errors=True) should work.
            context = browser.new_context(ignore_https_errors=True)
            page = context.new_page()
            page.set_viewport_size({'width': 1280, 'height': 800})

            page.goto("https://localhost:3000", timeout=10000)
        except Exception as e:
            print(f"Could not connect to localhost:3000: {e}")
            print("Please ensure the dev server is running.")
            return

        # Wait for the Event Log to appear
        # It's at the bottom right usually
        try:
            expect(page.get_by_text("Event Log")).to_be_visible(timeout=10000)

            # Find the Copy button
            copy_button = page.get_by_label("Copy Logs to Clipboard")
            expect(copy_button).to_be_visible()

            # Take a screenshot of the Event Log area
            # We can try to locate the container of "Event Log"
            event_log_container = page.locator("h3:has-text('Event Log')").locator("xpath=../..")

            event_log_container.screenshot(path="kalshi-dashboard/verification/verify_copy_logs.png")
            print("Screenshot saved to kalshi-dashboard/verification/verify_copy_logs.png")

            # Optional: Click it and check for visual feedback if possible
            copy_button.click()
            # The icon should change to Check
            # We can't easily screenshot the transient state reliably in this script without specific waits,
            # but we can assert the button is still there.

        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="kalshi-dashboard/verification/error_screenshot.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_copy_logs_ui()
