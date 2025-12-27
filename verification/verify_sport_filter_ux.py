
import pytest
from playwright.sync_api import Page, expect

@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {
        **browser_context_args,
        "ignore_https_errors": True
    }

def test_sport_filter_escape_key(page: Page):
    # Mock window.forge to prevent errors
    page.add_init_script("""
        window.forge = {
            pki: { privateKeyFromPem: () => ({ sign: () => 'sig' }) },
            md: { sha256: { create: () => ({ update: () => {} }) } },
            mgf: { mgf1: { create: () => {} } },
            pss: { create: () => {} },
            util: { encode64: () => 'encoded' }
        };
    """)

    # Load the app
    page.goto("https://localhost:3000")

    # Wait for the Sport Filter button and click it
    filter_btn = page.get_by_label("Filter by Sport")
    expect(filter_btn).to_be_visible()
    filter_btn.click()

    # Verify the dropdown is open (check for "Available Sports" text)
    dropdown = page.get_by_role("dialog", name="Select Sports")
    expect(dropdown).to_be_visible()

    # Press Escape
    page.keyboard.press("Escape")

    # Verify the dropdown is closed
    expect(dropdown).not_to_be_visible()

def test_sport_filter_width(page: Page):
    # Mock window.forge
    page.add_init_script("""
        window.forge = {
            pki: { privateKeyFromPem: () => ({ sign: () => 'sig' }) },
            md: { sha256: { create: () => ({ update: () => {} }) } },
            mgf: { mgf1: { create: () => {} } },
            pss: { create: () => {} },
            util: { encode64: () => 'encoded' }
        };
    """)

    # Set viewport to mobile size
    page.set_viewport_size({"width": 375, "height": 667})

    page.goto("https://localhost:3000")

    filter_btn = page.get_by_label("Filter by Sport")
    filter_btn.click()

    dropdown = page.get_by_role("dialog", name="Select Sports")

    # Get the bounding box
    box = dropdown.bounding_box()

    # If width is hardcoded to 600, it will be 600
    # On a 375px screen, this is bad UX (overflow)
    print(f"Dropdown width: {box['width']}")

    # We want the width to be constrained by the viewport (e.g. < 375 - margins)
    # But for this test, we just want to fail if it's > 400 (indicating fixed width)
    assert box['width'] < 380, f"Dropdown is too wide for mobile: {box['width']}px"
