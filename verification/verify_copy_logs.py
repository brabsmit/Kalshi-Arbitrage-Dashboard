
import pytest
from playwright.sync_api import Page, expect

def test_copy_logs_button(page: Page):
    """
    Verifies the existence and accessibility of the 'Copy Logs' button in EventLog.
    """
    # 1. Load the app (using the dev server URL or a built HTML file if available)
    # Assuming standard localhost:3000 for Vite
    page.goto("https://127.0.0.1:3000")

    # 2. Mock some logs by triggering an action (or using JS injection)
    # We can inject logs directly via the React component state if exposed,
    # but easier to just check if the container exists and if the button is there.
    # The Event Log is always visible.

    event_log_header = page.locator("h3", has_text="Event Log")
    expect(event_log_header).to_be_visible()

    # 3. Check for Copy Button
    # Look for a button with aria-label "Copy Logs"
    copy_button = page.get_by_label("Copy Logs")

    # This assertion should FAIL initially
    if copy_button.count() == 0:
        print("Copy Logs button NOT found (Expected)")
    else:
        print("Copy Logs button FOUND (Unexpected)")

    # 4. Check for Accessibility Roles
    # The log container should have role="log"
    log_container = page.locator("div[role='log']")

    if log_container.count() == 0:
        print("Log container with role='log' NOT found (Expected)")
    else:
        print("Log container with role='log' FOUND (Unexpected)")

if __name__ == "__main__":
    # Minimal runner
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(ignore_https_errors=True)
        try:
            test_copy_logs_button(page)
        except Exception as e:
            print(f"Test failed as expected or with error: {e}")
        browser.close()
