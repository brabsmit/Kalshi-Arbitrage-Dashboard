import pytest
from playwright.sync_api import Page, expect

def test_keys_migrate_to_session_storage(page: Page):
    """
    Verifies that keys placed in localStorage are migrated to sessionStorage
    and removed from localStorage upon app load.
    """
    # 1. Navigate to app
    page.goto("https://localhost:3000")

    # 2. Simulate legacy state: Keys in localStorage
    mock_keys = '{"keyId":"test_id","privateKey":"test_key"}'
    mock_odds_key = 'test_odds_key'

    page.evaluate(f"""() => {{
        localStorage.setItem('kalshi_keys', '{mock_keys}');
        localStorage.setItem('odds_api_key', '{mock_odds_key}');
    }}""")

    # 3. Reload to trigger the migration logic (useEffect)
    page.reload()

    # 4. Wait for React hydration and effects
    page.wait_for_timeout(2000)

    # 5. Check sessionStorage has the data
    session_keys = page.evaluate("sessionStorage.getItem('kalshi_keys')")
    session_odds = page.evaluate("sessionStorage.getItem('odds_api_key')")

    assert session_keys == mock_keys, "kalshi_keys should be migrated to sessionStorage"
    assert session_odds == mock_odds_key, "odds_api_key should be migrated to sessionStorage"

    # 6. Check localStorage does NOT have the data
    local_keys = page.evaluate("localStorage.getItem('kalshi_keys')")
    local_odds = page.evaluate("localStorage.getItem('odds_api_key')")

    assert local_keys is None, "kalshi_keys should be removed from localStorage"
    assert local_odds is None, "odds_api_key should be removed from localStorage"

def test_input_saves_to_session_storage(page: Page):
    """
    Verifies that entering the Odds API key saves to sessionStorage, not localStorage.
    """
    page.goto("https://localhost:3000")

    # Open Settings Modal
    page.get_by_label("Settings").click()

    # Find the Odds API Key input
    input_field = page.locator("#odds-api-key")
    expect(input_field).to_be_visible()

    # Type a new key
    new_key = "secure_session_key_123"
    input_field.fill(new_key)

    # Verify storage
    session_val = page.evaluate("sessionStorage.getItem('odds_api_key')")
    local_val = page.evaluate("localStorage.getItem('odds_api_key')")

    assert session_val == new_key, "Input should update sessionStorage"
    assert local_val is None, "Input should NOT update localStorage"
