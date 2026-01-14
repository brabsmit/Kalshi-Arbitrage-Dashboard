import pytest
from playwright.sync_api import expect
import time

def test_copy_logs_button(authenticated_page):
    """
    Verifies that the 'Copy Logs' button exists, can be clicked,
    and provides visual feedback (Check icon) upon success.
    """
    page = authenticated_page

    # Capture console logs
    page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))

    # Grant permissions to allow navigator.clipboard.writeText
    # Explicitly setting origin
    page.context.grant_permissions(['clipboard-read', 'clipboard-write'], origin='https://localhost:3000')

    # Locate the button using the aria-label we added
    copy_btn = page.get_by_label("Copy logs to clipboard")
    expect(copy_btn).to_be_visible()

    # Initial state: Should not have the success color class (emerald-500)
    expect(copy_btn.locator("svg.text-emerald-500")).not_to_be_visible()

    # Click the button
    copy_btn.click()

    # State after click: Should show success color class
    # This implies the promise resolved successfully and the icon changed to Check
    expect(copy_btn.locator("svg.text-emerald-500")).to_be_visible()

    # Verify visual feedback reverts after 2 seconds
    page.wait_for_timeout(2100)

    # Should revert to original state (no emerald-500)
    expect(copy_btn.locator("svg.text-emerald-500")).not_to_be_visible()
