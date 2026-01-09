import pytest
from playwright.sync_api import Page, expect

@pytest.fixture(scope="function")
def context(browser):
    context = browser.new_context(ignore_https_errors=True)
    yield context
    context.close()

@pytest.fixture(scope="function")
def page(context):
    page = context.new_page()
    yield page
    page.close()

def test_copy_logs_button(page: Page):
    """
    Verifies that the 'Copy Logs' button exists in the Event Log component
    and has the correct accessibility attributes.
    """
    # Navigate to the app (assuming it's running, but we might need to mock if it's not)
    # The app is running on HTTPS via Vite

    page.goto("https://localhost:3000")

    # Check if Event Log header exists
    event_log_header = page.get_by_text("Event Log", exact=False)
    expect(event_log_header).to_be_visible()

    # Check for the copy button within the Event Log container
    # We look for a button with the specific aria-label we intend to add
    copy_button = page.get_by_role("button", name="Copy logs to clipboard")

    # It should be visible
    expect(copy_button).to_be_visible()

    # It should have a title for tooltip
    expect(copy_button).to_have_attribute("title", "Copy Logs")

    # Optional: Click it and check for visual feedback (Check icon)
    # Note: Checking clipboard content is tricky in headless mode without permissions,
    # but we can check the UI state change (icon change).
    copy_button.click()

    # We expect the icon to change to a checkmark or similar
    # In our implementation plan, we toggle state to show a Check icon.
    # We can check if the button now contains a "Check" icon (by class or SVG)
    # or if we can verify the state change.
    # A simpler check is that the button is still visible and focused.
