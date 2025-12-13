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
    close_btn = page.get_by_role("button", name="Close", exact=True)
    expect(close_btn).to_be_visible()
    close_btn.click()
    expect(page.get_by_text("Bot Configuration")).not_to_be_visible()

    # Open Schedule Modal
    page.get_by_label("Run Schedule").click()
    expect(page.get_by_text("Schedule Run")).to_be_visible()

    # Check close button
    page.get_by_role("button", name="Close", exact=True).click()
    expect(page.get_by_text("Schedule Run")).not_to_be_visible()

    # Open Export Modal
    page.get_by_label("Session Reports").click()
    expect(page.get_by_text("Session Reports")).to_be_visible()

    # Check close button
    page.get_by_role("button", name="Close", exact=True).click()
    expect(page.get_by_text("Session Reports")).not_to_be_visible()

    # 4. CHECK NEW ACCESSIBILITY ATTRIBUTES

    # Open Settings Modal again to check inputs
    page.get_by_label("Settings").click()

    # Check new labels
    expect(page.get_by_label("Auto-Bid Margin")).to_be_visible()
    expect(page.get_by_label("Auto-Close Margin")).to_be_visible()
    expect(page.get_by_label("Max Positions")).to_be_visible()

    # Check inputs with associated labels
    expect(page.get_by_label("Trade Size (Contracts)")).to_be_visible()
    expect(page.get_by_label("The-Odds-API Key")).to_be_visible()

    page.get_by_role("button", name="Close", exact=True).click()

    # Open Schedule Modal again
    page.get_by_label("Run Schedule").click()

    expect(page.get_by_label("Enable Schedule")).to_be_visible()
    expect(page.get_by_label("Start Time")).to_be_visible()
    expect(page.get_by_label("End Time")).to_be_visible()

    page.get_by_role("button", name="Close", exact=True).click()
