
from playwright.sync_api import sync_playwright
import time
import os

def test_disconnect_wallet():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--ignore-certificate-errors'])
        # Grant permissions to read clipboard if needed, though mostly using mock
        context = browser.new_context(
            permissions=["clipboard-read", "clipboard-write"],
            storage_state=None,
            ignore_https_errors=True
        )
        page = context.new_page()

        # Inject fake keys into sessionStorage to simulate connected state
        fake_keys = '{"keyId":"TEST-KEY-123","privateKey":"FAKE-PEM-CONTENT"}'

        # We need to navigate first to set storage
        try:
            page.goto("https://localhost:3000")
        except Exception as e:
            print(f"Failed to load page: {e}")
            return

        # Inject sessionStorage
        page.evaluate(f"sessionStorage.setItem('kalshi_keys', '{fake_keys}')")
        page.reload()

        # Wait for page load
        page.wait_for_timeout(2000)

        # 1. Verify "Wallet Active" button is present (Header)
        try:
            wallet_btn = page.get_by_text("Wallet Active")
            wallet_btn.wait_for(timeout=5000)
            if not wallet_btn.is_visible():
                print("Wallet Active button not found! Injection failed or UI broken.")
                page.screenshot(path="verification/failed_injection.png")
                return
        except:
             print("Wallet Active button timeout.")
             page.screenshot(path="verification/timeout.png")
             return

        print("Wallet Active button found.")

        # 2. Click "Wallet Active" to open modal
        wallet_btn.click()

        # 3. Verify Modal shows "Active Session" and "Disconnect" button
        # Look for "Active Session"
        try:
            page.get_by_text("Active Session").wait_for(timeout=3000)
            print("Active Session text found.")
        except:
             print("Active Session text NOT found.")

        # Look for ID
        try:
            page.get_by_text("ID: TEST-KEY-123").wait_for(timeout=3000)
            print("Key ID found.")
        except:
             print("Key ID NOT found.")

        # Look for Disconnect Button
        disconnect_btn = page.get_by_role("button", name="Disconnect Wallet")
        if disconnect_btn.is_visible():
            print("Disconnect button is visible.")
        else:
            print("Disconnect button NOT visible.")

        # Take screenshot of the modal
        page.screenshot(path="verification/disconnect_modal.png")

        # 4. Click Disconnect
        disconnect_btn.click()

        # 5. Verify "Connect Wallet" button returns in Header
        page.wait_for_timeout(1000)
        connect_btn = page.get_by_text("Connect Wallet")
        if connect_btn.is_visible():
            print("Successfully disconnected. 'Connect Wallet' visible.")
        else:
            print("Failed to disconnect.")

        # Verify sessionStorage is cleared
        keys = page.evaluate("sessionStorage.getItem('kalshi_keys')")
        if keys is None:
             print("SessionStorage cleared.")
        else:
             print("SessionStorage NOT cleared.")

        browser.close()

if __name__ == "__main__":
    test_disconnect_wallet()
