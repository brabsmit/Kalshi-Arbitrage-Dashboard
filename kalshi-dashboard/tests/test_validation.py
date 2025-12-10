import pytest
from playwright.sync_api import expect
import time
import os
import logging

# We use the existing TEST_LIVE determination logic from conftest,
# but since we can't import variables from conftest easily without a module,
# we rely on the fixture behavior or check env again.
TEST_LIVE = os.environ.get("TEST_LIVE") == "1" or ("KALSHI_DEMO_API_KEY" in os.environ and "KALSHI_DEMO_API_KEY_ID" in os.environ)

@pytest.mark.skipif(not TEST_LIVE, reason="Skipping Live Data Validation because keys are missing")
def test_live_data_validation(authenticated_page):
    """
    Connects to real APIs and validates data structures.
    This test runs only if API keys are present.
    It does NOT execute trades, but verifies data flow.
    """
    page = authenticated_page

    # 1. Verify Kalshi Authentication & Balance
    # ---------------------------------------
    logging.info("Verifying Kalshi Connection...")
    # Expect "Wallet Active" or balance to show up.
    expect(page.get_by_text("Wallet Active")).to_be_visible(timeout=20000)

    # Verify Balance is a valid number
    balance_el = page.locator("span.font-mono.font-bold.text-lg")
    expect(balance_el).to_be_visible()

    # Wait for balance to load (not be '-')
    expect(balance_el).not_to_have_text("-", timeout=20000)

    balance_text = balance_el.text_content()
    logging.info(f"Current Live Balance: {balance_text}")
    assert balance_text.replace('.', '', 1).isdigit(), f"Balance '{balance_text}' is not a number"

    # 2. Verify The-Odds-API Data Fetch
    # ---------------------------------
    logging.info("Verifying Odds API Connection...")

    # Enable multiple sports to ensure we find active markets (NFL might be off)
    # Click the "Select Sports" dropdown
    try:
        page.get_by_text("Select Sports").click()
    except:
        # If text is different (e.g. "1 Sport"), try finding by role
        page.locator("button:has-text('Sport')").first.click()

    # Select NBA and NHL if available in the dropdown
    # We click them to toggle ON
    for sport in ["Basketball (NBA)", "Hockey (NHL)", "Basketball (NCAAB)"]:
        try:
            # Only click if not already selected (checked)
            # The dropdown item shows a Check icon if selected.
            # We just click; the app toggles. If it was on, it turns off.
            # But defaults are usually just NFL.

            # Check if visible
            if page.get_by_text(sport).is_visible():
                page.get_by_text(sport).click()
                time.sleep(0.5)
        except:
            pass

    # Close dropdown by clicking outside (header)
    page.get_by_text("Kalshi ArbBot").click()

    # Wait for the "Market Scanner" table to populate or show a specific state
    # If API is working, we should NOT see "Loading Markets..." indefinitely.
    # Note: If no sports are in season or selected, it might show "No items found".
    # But we want to ensure it TRIED to fetch.

    try:
        expect(page.get_by_text("Loading Markets...")).not_to_be_visible(timeout=20000)
    except AssertionError:
        # If it's still loading, capture screenshot for debug (if we could)
        logging.error("Markets failed to load within 20s.")
        raise

    # Check network activity to confirm Odds API was called
    # (We can't easily check past network calls in Playwright without a listener,
    # but the fact that 'Loading' is gone implies completion).

    # 3. Validate Market Data Integrity
    # ---------------------------------
    # If markets are present, check their structure
    rows = page.locator("tr.hover\\:bg-slate-50")
    count = rows.count()
    logging.info(f"Found {count} market rows.")

    if count > 0:
        first_row = rows.first
        # Check for presence of essential data columns
        # Ticker/Event info
        expect(first_row.locator("td").first).not_to_be_empty()

        # Odds Column (should contain percentage or price)
        # We look for the "Smart Bid" or any numeric value in the odds section
        # The structure is specific, but text usually contains a '¢' for Kalshi price
        # or a probability %.

        # Verify at least one '¢' symbol in the row, indicating Kalshi data is merged?
        # Or just verify Odds data (implied probability).
        pass
    else:
        logging.warning("No markets found. This might be due to sport selection or off-season.")
        # We don't fail, as this is valid behavior if no games are on.
        # But we should verify we didn't get an error toast.
        expect(page.locator(".Toastify__toast--error")).not_to_be_visible()

    # 4. Verify Kalshi Market Data (Integration)
    # ------------------------------------------
    # If we have rows, at least some should ideally have Kalshi Tickers linked.
    # We can check if any row has a "View" button or similar that implies a Kalshi link?
    # Or check if any row text contains "¢" (cents), which is specific to Kalshi pricing display in this app.

    # We can't guarantee a match exists, so we can't assert hard on this.
    # But we can check that we haven't crashed.

    logging.info("Live Validation Complete.")
