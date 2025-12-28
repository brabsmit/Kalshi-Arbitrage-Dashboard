
import os
import time
from playwright.sync_api import sync_playwright, expect

# Verification of UX improvements:
# 1. New Empty State for Market Scanner (No sports selected)
# 2. ARIA roles for Portfolio Tabs

def verify_ux_improvements():
    with sync_playwright() as p:
        # Launch browser with ignore_https_errors because dev server uses self-signed cert
        browser = p.chromium.launch(headless=True, args=["--ignore-certificate-errors"])
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        print("Navigating to dashboard...")
        page.goto("https://localhost:3000")

        # Wait for app to load
        print("Waiting for app to load...")
        page.wait_for_selector("h1", timeout=10000)

        # MOCK SETUP: Ensure we can manipulate state or UI
        # We need to trigger "No sports selected".
        # The easiest way is to click the Sport Filter and Clear it.

        # 1. Open Sport Filter
        print("Opening Sport Filter...")
        filter_btn = page.get_by_role("button", name="Filter by Sport")
        filter_btn.click()

        # 2. Click Clear (if available - might depend on initial state)
        # If "Clear" is not visible, it means no sports are selected or UI is different.
        # But default state has NFL selected.

        # Check if Clear button exists
        clear_btn = page.get_by_role("button", name="Clear")
        if clear_btn.is_visible():
            print("Clicking Clear...")
            clear_btn.click()
        else:
            print("Clear button not visible, checking current selection...")
            # If not visible, maybe already empty?

        # 3. Close the filter dropdown (Escape or click outside)
        # Clicking outside
        page.mouse.click(0, 0)

        # 4. Verify Empty State
        print("Verifying Empty State...")
        # Look for "No sports selected" text
        empty_state_text = page.get_by_text("No sports selected")
        expect(empty_state_text).to_be_visible()

        # Look for Trophy icon (we can't easily verify icon content, but we can verify container)
        # Look for "Select NFL" button
        select_nfl_btn = page.get_by_role("button", name="Select NFL")
        expect(select_nfl_btn).to_be_visible()

        print("Empty State verified!")

        # 5. Verify Portfolio Tabs Accessibility
        print("Verifying Portfolio Tabs Accessibility...")

        # Check tablist
        tablist = page.get_by_role("tablist", name="Portfolio Views")
        expect(tablist).to_be_visible()

        # Check individual tabs
        positions_tab = page.get_by_role("tab", name="positions")
        expect(positions_tab).to_be_visible()
        expect(positions_tab).to_have_attribute("aria-selected", "false") # default is 'resting'

        resting_tab = page.get_by_role("tab", name="resting")
        expect(resting_tab).to_have_attribute("aria-selected", "true")

        # Check tabpanel
        # The tabpanel should have aria-labelledby="tab-resting"
        panel = page.locator("div[role='tabpanel']")
        expect(panel).to_have_attribute("aria-labelledby", "tab-resting")

        print("Tabs Accessibility verified!")

        # Take screenshot
        page.screenshot(path="/home/jules/verification/ux_improvements.png")
        print("Screenshot saved to /home/jules/verification/ux_improvements.png")

        browser.close()

if __name__ == "__main__":
    verify_ux_improvements()
