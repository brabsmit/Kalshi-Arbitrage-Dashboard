import pytest
from playwright.sync_api import expect
import re

def test_palette_accessibility_improvements(authenticated_page):
    """
    Verify Palette's accessibility improvements:
    - aria-pressed on toggle buttons
    - aria-label on icon-only buttons
    - aria-describedby on form inputs with helper text
    """
    page = authenticated_page

    # 1. Check Toggle Buttons (Turbo, Auto-Bid, Auto-Close)

    # Turbo Mode Button
    # Should have a label now (it didn't before)
    turbo_btn = page.get_by_label("Toggle Turbo Mode")
    expect(turbo_btn).to_be_visible()

    # Should have aria-pressed
    # We don't know the default state (depends on localStorage or default), but it should be present
    expect(turbo_btn).to_have_attribute("aria-pressed", re.compile(r"true|false"))

    # Should have title
    expect(turbo_btn).to_have_attribute("title", "Turbo Mode (3s updates)")

    # Auto-Bid Button
    # It has text "Auto-Bid ON/OFF", so get_by_role("button", name="Auto-Bid") should work
    # But text changes. Let's try partial text or regex.
    auto_bid_btn = page.get_by_role("button", name=re.compile(r"Auto-Bid (ON|OFF)"))
    expect(auto_bid_btn).to_be_visible()
    expect(auto_bid_btn).to_have_attribute("aria-pressed", re.compile(r"true|false"))

    # Auto-Close Button
    auto_close_btn = page.get_by_role("button", name=re.compile(r"Auto-Close (ON|OFF)"))
    expect(auto_close_btn).to_be_visible()
    expect(auto_close_btn).to_have_attribute("aria-pressed", re.compile(r"true|false"))

    # 2. Check Settings Inputs for aria-describedby

    # Open Settings
    page.get_by_label("Settings").click()

    # Wait for modal
    expect(page.get_by_text("Bot Configuration")).to_be_visible()

    # Check Auto-Bid Margin
    bid_margin_input = page.get_by_label("Auto-Bid Margin")
    expect(bid_margin_input).to_be_visible()

    # Check for aria-describedby
    expect(bid_margin_input).to_have_attribute("aria-describedby", re.compile(r".+"))

    # Verify the description element exists and has content
    desc_id = bid_margin_input.get_attribute("aria-describedby")
    # useId generates IDs with colons like :r1:, which breaks #selector. Use attribute selector.
    description_el = page.locator(f'[id="{desc_id}"]')
    expect(description_el).to_be_visible()
    expect(description_el).to_contain_text("Bot will bid")

    # Check Auto-Close Margin
    close_margin_input = page.get_by_label("Auto-Close Margin")
    expect(close_margin_input).to_have_attribute("aria-describedby", re.compile(r".+"))

    desc_id_2 = close_margin_input.get_attribute("aria-describedby")
    expect(page.locator(f'[id="{desc_id_2}"]')).to_contain_text("Bot will ask")

    # Check Min Fair Value
    mfv_input = page.get_by_label("Minimum Fair Value")
    expect(mfv_input).to_have_attribute("aria-describedby", re.compile(r".+"))

    desc_id_3 = mfv_input.get_attribute("aria-describedby")
    expect(page.locator(f'[id="{desc_id_3}"]')).to_contain_text("Bot will ignore")
