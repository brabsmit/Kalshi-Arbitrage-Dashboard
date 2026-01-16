import pytest
from playwright.sync_api import expect

def test_copy_logs_button(authenticated_page):
    """
    Verify the 'Copy Logs' button in the EventLog component.
    """
    page = authenticated_page

    # 1. Locate the Event Log section
    event_log_header = page.get_by_role("heading", name="Event Log")
    expect(event_log_header).to_be_visible()

    # 2. Check if the Copy button exists in the header
    copy_button = page.get_by_label("Copy logs to clipboard")
    expect(copy_button).to_be_visible()

    # 3. Take screenshot
    page.screenshot(path="../verification/verification.png")

    # 4. Verify state
    if page.get_by_text("No events yet").is_visible():
        expect(copy_button).to_be_disabled()
    else:
        expect(copy_button).to_be_enabled()
