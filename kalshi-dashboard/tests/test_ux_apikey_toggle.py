import pytest
import json
from playwright.sync_api import expect

# --- MOCK DATA ---
def generate_odds_response():
    return [{"key": "americanfootball_nfl", "title": "NFL", "active": True}]

def generate_kalshi_markets():
    return {"markets": []}

def test_apikey_visibility_toggle(authenticated_page):
    """
    Verify that the API Key input can toggle between password and text types.
    """
    page = authenticated_page

    # 1. SETUP MOCKS
    # We mock the API calls to prevent the dashboard from stalling or erroring out
    page.route(lambda url: "api.the-odds-api.com" in url, lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(generate_odds_response())
    ))
    page.route("**/api/kalshi/markets*", lambda route: route.fulfill(json=generate_kalshi_markets()))
    page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json={"balance": 100000}))
    page.route("**/api/kalshi/portfolio/orders*", lambda route: route.fulfill(json={"orders": []}))
    page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(json={"market_positions": []}))

    page.reload()

    # 2. Open Settings Modal
    settings_btn = page.get_by_label("Settings")
    expect(settings_btn).to_be_visible()
    settings_btn.click()

    # 3. Verify Modal is Open
    expect(page.get_by_text("Bot Configuration")).to_be_visible()

    # 4. Find API Key Input
    # Label is "The-Odds-API Key"
    # Note: Depending on implementation, label might be associated via htmlFor
    # In current App.jsx: <label htmlFor="odds-api-key">...
    # So we can use get_by_label
    api_input = page.get_by_label("The-Odds-API Key")
    expect(api_input).to_be_visible()

    # 5. Initial State: Password
    expect(api_input).to_have_attribute("type", "password")

    # 6. Find Toggle Button
    # It should have aria-label "Show API Key"
    toggle_btn = page.get_by_label("Show API Key")

    # This expectation should FAIL initially
    expect(toggle_btn).to_be_visible()

    # 7. Click Toggle -> Show
    toggle_btn.click()

    # 8. Verify State: Text
    expect(api_input).to_have_attribute("type", "text")

    # 9. Verify Button Label Change
    # The button label should now be "Hide API Key"
    hide_btn = page.get_by_label("Hide API Key")
    expect(hide_btn).to_be_visible()

    # 10. Click Toggle -> Hide
    hide_btn.click()

    # 11. Verify State: Password
    expect(api_input).to_have_attribute("type", "password")
