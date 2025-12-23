import pytest
import json
from playwright.sync_api import expect

def test_modal_keyboard_interaction(authenticated_page):
    page = authenticated_page

    # Mock External APIs to ensure UI loads cleanly
    page.route("**/*api.the-odds-api.com/*", lambda r: r.fulfill(
        status=200, content_type="application/json", body=json.dumps([{"key": "americanfootball_nfl", "title": "NFL", "active": True}])
    ))
    page.route("**/api/kalshi/markets*", lambda r: r.fulfill(json={"markets": []}))

    page.reload()

    # Wait for hydration
    page.wait_for_timeout(1000)

    # 1. Settings Modal
    print("Testing Settings Modal...")
    settings_btn = page.get_by_label("Settings")
    settings_btn.click()
    expect(page.get_by_text("Bot Configuration")).to_be_visible()

    # Press Escape
    print("Pressing Escape...")
    page.keyboard.press("Escape")
    expect(page.get_by_text("Bot Configuration")).not_to_be_visible()

    # 2. Re-open and Click Outside
    print("Testing Click Outside...")
    settings_btn.click()
    expect(page.get_by_text("Bot Configuration")).to_be_visible()

    # Click on the backdrop.
    # The modal is centered. A click at (10, 10) should hit the overlay (which covers inset-0).
    page.mouse.click(10, 10)
    expect(page.get_by_text("Bot Configuration")).not_to_be_visible()

    # 3. Schedule Modal
    print("Testing Schedule Modal...")
    schedule_btn = page.get_by_label("Run Schedule")
    schedule_btn.click()
    expect(page.get_by_text("Schedule Run")).to_be_visible()

    page.keyboard.press("Escape")
    expect(page.get_by_text("Schedule Run")).not_to_be_visible()

    # 4. Reports Modal
    print("Testing Reports Modal...")
    reports_btn = page.get_by_label("Session Reports")
    reports_btn.click()
    expect(page.get_by_text("Session Reports")).to_be_visible()

    page.mouse.click(10, 10) # Click backdrop
    expect(page.get_by_text("Session Reports")).not_to_be_visible()
