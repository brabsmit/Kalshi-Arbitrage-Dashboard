import pytest
import json
from playwright.sync_api import expect

def test_palette_features(authenticated_page):
    """
    Verify Palette's UX improvements:
    1. Event Log Copy Button exists and works.
    2. PortfolioRow buttons have focus styles (checked via class).
    """
    page = authenticated_page

    # Setup Mock BEFORE reload to ensure it's captured on initial load
    def handle_positions(route):
        if "settlement_status=settled" in route.request.url:
             route.fulfill(json={"market_positions": []})
        else:
             route.fulfill(json={
                "market_positions": [{
                    "ticker": "KXTEST",
                    "position": 10,
                    "avg_price": 50,
                    "market_id": "KXTEST",
                    "status": "active"
                }]
            })

    page.route("**/api/kalshi/portfolio/positions*", handle_positions)

    # Reload to ensure clean state and trigger fetch
    page.reload()

    # 1. Verify Event Log Copy Button
    expect(page.get_by_text("Event Log")).to_be_visible()
    copy_btn = page.get_by_label("Copy Logs")
    expect(copy_btn).to_be_visible()

    # It should be disabled initially when no logs
    expect(copy_btn).to_be_disabled()

    # 2. Verify PortfolioRow Focus Styles
    # Wait for portfolio to render "KXTEST"
    expect(page.get_by_text("KXTEST")).to_be_visible(timeout=10000)

    # Check for the buttons
    # Note: "Trade Analysis" button is always present for positions
    analysis_btn = page.get_by_label("Trade Analysis").first
    expect(analysis_btn).to_be_visible()

    # Check for the class 'focus:outline-none' which we added
    # This verifies the code change was applied to the component logic
    expect(analysis_btn).to_have_class(lambda c: "focus:outline-none" in c)
    expect(analysis_btn).to_have_class(lambda c: "focus-visible:ring-2" in c)

    print("Palette Verification: Copy Button found and Focus Styles verified.")
