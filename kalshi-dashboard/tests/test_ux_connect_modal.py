import pytest
from playwright.sync_api import expect
import re

def test_connect_modal_ux(page):
    """
    Verify the UX improvements in the Connect Modal:
    - Proper labels for API Key ID and Private Key
    - Improved file drop zone visual structure
    - Status indicators
    """
    page.goto("https://localhost:3000")

    # Open Connect Modal
    connect_btn = page.get_by_role("button", name="Connect Wallet")
    expect(connect_btn).to_be_visible()
    connect_btn.click()

    # Wait for modal header
    expect(page.get_by_text("Connect Kalshi API")).to_be_visible()

    # 1. Verify API Key ID Label
    # The DOM text is "API Key ID" (CSS handles uppercase)
    label = page.get_by_text("API Key ID", exact=True)
    expect(label).to_be_visible()

    # Verify input association
    input_el = page.get_by_placeholder("Enter your Key ID")
    expect(input_el).to_be_visible()

    input_id = input_el.get_attribute("id")
    expect(label).to_have_attribute("for", input_id)

    # 2. Verify Private Key Section
    # DOM text is "Private Key"
    pk_label = page.get_by_text("Private Key", exact=True)
    expect(pk_label).to_be_visible()

    # Check label association
    # The file input is hidden (opacity 0) but should still be associated
    file_input = page.locator("input[type='file']")
    pk_input_id = file_input.get_attribute("id")
    expect(pk_label).to_have_attribute("for", pk_input_id)

    # Check for Drop Zone Text
    expect(page.get_by_text("Click to upload .key file")).to_be_visible()
    expect(page.get_by_text("or drag and drop here")).to_be_visible()

    # 3. Check for Info Tip
    expect(page.get_by_text("Keys stored locally. Supports standard PKCS#1 keys.")).to_be_visible()

    # 4. Check for visual classes
    # Parent of the file input
    drop_zone = page.locator('input[type="file"]').locator("..")

    # Check for hover styles
    expect(drop_zone).to_have_class(re.compile(r"hover:bg-slate-50"))
    expect(drop_zone).to_have_class(re.compile(r"hover:border-blue-400"))
