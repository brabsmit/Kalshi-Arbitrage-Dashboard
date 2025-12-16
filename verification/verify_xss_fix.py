import time
import json
import pytest
from playwright.sync_api import sync_playwright

def test_xss_in_print_report():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Create context with ignore_https_errors
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        # Inject malicious data via localStorage before page logic runs
        malicious_event = "<script>window.xss_triggered=true</script><b>Malicious Event</b>"
        malicious_ticker = "KX-MALICIOUS"

        trade_history = {
            malicious_ticker: {
                "orderPlacedAt": 1700000000000,
                "ticker": malicious_ticker,
                "event": malicious_event,
                "action": "BID",
                "sportsbookOdds": 100,
                "fairValue": 50,
                "bidPrice": 40,
                "source": "auto",
                "oddsTime": 1699999990000
            }
        }

        # Go to the app
        print("Navigating to app...")
        try:
            page.goto("https://localhost:3000")
        except Exception as e:
            print(f"Navigation failed: {e}")
            browser.close()
            return

        # Inject localStorage
        print("Injecting malicious localStorage...")
        # We need to set item and then reload to ensure app picks it up on mount
        page.evaluate(f"localStorage.setItem('kalshi_trade_history', JSON.stringify({json.dumps(trade_history)}))")
        page.reload()

        # Wait for app to load (checking for Header)
        try:
            page.wait_for_selector("text=Kalshi ArbBot", timeout=10000)
        except Exception as e:
             print("App failed to load or header not found.")
             print(page.content())
             browser.close()
             return

        # Open Export Modal
        print("Opening Session Reports...")
        try:
            page.get_by_label("Session Reports").click()
        except:
             # Fallback if label missing, try by title
             page.get_by_title("Session Reports").click()


        # Handle popup
        print("Triggering Print...")
        with page.expect_popup() as popup_info:
            page.get_by_text("Print / Save PDF").click()

        popup = popup_info.value
        popup.wait_for_load_state()

        content = popup.content()
        print("Popup content retrieved.")

        # Check if script tag is raw
        if "<script>window.xss_triggered=true</script>" in content:
            print("VULNERABILITY CONFIRMED: Raw script tag found in print output.")
        else:
            print("SAFE: Script tag not found or escaped.")

        browser.close()

if __name__ == "__main__":
    test_xss_in_print_report()
