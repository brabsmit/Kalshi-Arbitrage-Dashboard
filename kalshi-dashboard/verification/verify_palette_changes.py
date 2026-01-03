
import os
from playwright.sync_api import sync_playwright

def verify_settings_modal():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Allow self-signed certs (localhost)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        try:
            # Go to local dev server
            page.goto("https://localhost:3000")

            # Wait for header to load
            page.wait_for_selector("header")

            # Click "Settings" button in header (gear icon)
            # The button has aria-label="Settings"
            settings_btn = page.locator('button[aria-label="Settings"]')
            settings_btn.click()

            # Wait for modal
            page.wait_for_selector("text=Bot Configuration")

            # Verify inputs exist
            # We added IDs like `bidMarginId-input`, `closeMarginId-input`...
            # but since IDs are generated with `useId`, they are dynamic like `:r1:-input`.
            # However, we can find them by label text.

            # Verify "Auto-Bid Margin" number input
            # The label is "Auto-Bid Margin", pointing to the number input.
            bid_margin_input = page.get_by_label("Auto-Bid Margin", exact=True).locator("xpath=..//input[@type='number']")
            # Wait, our structure is:
            # Label (for number input)
            # Number Input
            # Range Input (aria-label="Auto-Bid Margin")

            # The range input has the aria-label "Auto-Bid Margin".
            # The number input is associated via label text "Auto-Bid Margin" (via htmlFor).

            # Let's target the number input directly.
            # It should have type="number" and follow the label "Auto-Bid Margin".

            # But wait, both the label and the range input use the same text?
            # In RangeSetting:
            # <label htmlFor={`${id}-input`}>{label}</label> ... <input id={`${id}-input`} type="number" ... />
            # <input id={id} type="range" aria-label={label} ... />

            # So page.get_by_label("Auto-Bid Margin") might find the range input (via aria-label) OR the number input (via label text).
            # Playwright prioritizes visible labels.

            # Let's look for type="number" specifically.
            number_inputs = page.locator("input[type='number']")

            print(f"Found {number_inputs.count()} number inputs in modal.")

            # Change value of first number input (Auto-Bid Margin)
            first_input = number_inputs.first
            first_input.fill("25")

            # Verify the range input updated?
            # Hard to verify range visually without JS checking value.

            # Take screenshot of the Settings Modal
            page.screenshot(path="verification/settings_modal_inputs.png")
            print("Screenshot saved to verification/settings_modal_inputs.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_settings_modal()
