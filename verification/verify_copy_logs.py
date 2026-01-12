import pytest
from playwright.sync_api import Page, expect

@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {
        **browser_context_args,
        "ignore_https_errors": True,
    }

def test_copy_logs_button(page: Page):
    # 1. Navigate to the app (using HTTPS since basicSsl is on)
    page.goto("https://localhost:3000")

    # 2. Wait for the Event Log header to appear
    event_log_header = page.get_by_role("heading", name="Event Log")
    expect(event_log_header).to_be_visible()

    # 3. Look for the Copy button
    copy_button = page.get_by_role("button", name="Copy logs")

    # Assert it exists
    expect(copy_button).to_be_visible()
