import pytest
from playwright.sync_api import Page, expect

@pytest.fixture(scope="function")
def context(playwright):
    browser = playwright.chromium.launch(headless=True, args=['--ignore-certificate-errors'])
    context = browser.new_context(ignore_https_errors=True)
    yield context
    browser.close()

def test_copy_logs_ui(page: Page):
    # Enable ignore_https_errors
    page.context.set_extra_http_headers({"Accept": "*/*"})

    # Grant clipboard permissions
    context = page.context
    context.grant_permissions(['clipboard-read', 'clipboard-write'])

    # Navigate to the dashboard
    page.goto("https://localhost:3000")

    # Wait for the Event Log to be visible
    event_log = page.locator("text=Event Log")
    expect(event_log).to_be_visible()

    # Check for the Copy Logs button
    copy_button = page.get_by_label("Copy Logs")
    expect(copy_button).to_be_visible()

    # Take a screenshot
    page.screenshot(path="verification_screenshot.png")
