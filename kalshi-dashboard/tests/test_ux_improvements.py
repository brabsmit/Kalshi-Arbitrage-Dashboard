import pytest
import json
from playwright.sync_api import expect

# --- MOCK DATA ---
def generate_odds_response():
    return [{"key": "americanfootball_nfl", "title": "NFL", "active": True}]

def generate_kalshi_markets():
    return {"markets": []}

# --- TESTS ---
def test_ux_aria_labels(authenticated_page):
    """
    Verify that interactive elements have proper ARIA labels.
    """
    page = authenticated_page

    # 1. SETUP MOCKS
    page.route(lambda url: "api.the-odds-api.com" in url, lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(generate_odds_response())
    ))
    page.route("**/api/kalshi/markets*", lambda route: route.fulfill(json=generate_kalshi_markets()))
    page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json={"balance": 100000}))
    page.route("**/api/kalshi/portfolio/orders*", lambda route: route.fulfill(json={"orders": []}))
    page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(json={"market_positions": []}))

    page.reload()

    # 2. CHECK HEADER BUTTONS
    # The header buttons should have aria-labels.
    expect(page.get_by_label("Settings")).to_be_visible()
    expect(page.get_by_label("Run Schedule")).to_be_visible()
    expect(page.get_by_label("Session Reports")).to_be_visible()

    # 3. CHECK MODAL CLOSE BUTTONS

    # Open Settings Modal
    page.get_by_label("Settings").click()
    expect(page.get_by_text("Bot Configuration")).to_be_visible()

    # Check for Close button using accessible name
    close_btn = page.get_by_label("Close")
    expect(close_btn).to_be_visible()
    close_btn.click()
    expect(page.get_by_text("Bot Configuration")).not_to_be_visible()

    # Open Schedule Modal
    page.get_by_label("Run Schedule").click()
    expect(page.get_by_text("Schedule Run")).to_be_visible()

    # Check close button
    page.get_by_label("Close").click()
    expect(page.get_by_text("Schedule Run")).not_to_be_visible()

    # Open Export Modal
    page.get_by_label("Session Reports").click()
    expect(page.get_by_text("Session Reports")).to_be_visible()

    # Check close button
    page.get_by_label("Close").click()
    expect(page.get_by_text("Session Reports")).not_to_be_visible()
