from playwright.sync_api import sync_playwright
import time
import json

def verify_animations():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Mock forge
        page.add_init_script("""
            window.forge = {
                pki: { privateKeyFromPem: () => ({ sign: () => 'mock_sig' }) },
                md: { sha256: { create: () => ({ update: () => {} }) } },
                pss: { create: () => {} },
                mgf: { mgf1: { create: () => {} } },
                util: { encode64: () => 'mock_encoded' }
            };
        """)

        # Mock WebSocket
        page.add_init_script("""
            window.WebSocket = class {
                constructor() { this.readyState = 1; }
                send() {}
                close() {}
                set onopen(fn) { setTimeout(fn, 100); }
                set onmessage(fn) {}
                set onclose(fn) {}
            };
        """)

        # Mock Wallet Keys
        page.add_init_script("""
            localStorage.setItem('kalshi_keys', JSON.stringify({ keyId: 'test', privateKey: 'test' }));
        """)

        # Initial Route - Empty
        page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(
            status=200,
            body=json.dumps({"market_positions": []})
        ))

        # Mock other endpoints
        page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json={"balance": 100000}))
        page.route("**/api/kalshi/portfolio/orders", lambda route: route.fulfill(json={"orders": []}))
        page.route("**/api/kalshi/markets*", lambda route: route.fulfill(json={"markets": []}))
        page.route("**/sports/*/odds/*", lambda route: route.fulfill(json=[]))

        page.goto("http://localhost:3000/")

        # Click the "positions" button. Note: The button text is "positions" (lowercase in array map), but rendered uppercase via CSS?
        # The code: {['positions', 'resting', 'history'].map(tab => ( <button ...>{tab}</button> ))}
        # The CSS: uppercase tracking-wider
        # So the text content in DOM is "positions" but visuals are uppercase.
        # Playwright get_by_text is case-insensitive usually or exact.
        # Let's try get_by_role("button", name="positions")

        print("Clicking POSITIONS tab...")
        try:
             page.get_by_role("button", name="positions").click(timeout=5000)
        except:
             # Fallback
             print("Fallback click...")
             page.get_by_text("positions").click()

        print("Initial load complete.")
        time.sleep(1)

        # 1. Trigger NEW item (Flash Green)
        print("Triggering NEW item...")
        new_item = {
            "ticker": "TEST-23JAN01-A",
            "position": 10,
            "total_cost": 500,
            "fees_paid": 10,
            "settlement_status": "unsettled"
        }

        page.unroute("**/api/kalshi/portfolio/positions*")
        page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(
            status=200,
            body=json.dumps({"market_positions": [new_item]})
        ))

        # Wait for the item to appear
        try:
            page.wait_for_selector("text=TEST-23JAN01-A", timeout=10000)
            print("Item appeared.")
        except:
            print("Item did not appear in time.")

        page.screenshot(path="verification/1_new_item_green.png")

        time.sleep(1.5)
        page.screenshot(path="verification/2_item_stable.png")

        # 2. Trigger REMOVED item (Flash Red)
        print("Triggering REMOVED item...")
        page.unroute("**/api/kalshi/portfolio/positions*")
        page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(
            status=200,
            body=json.dumps({"market_positions": []})
        ))

        print("Waiting for removal...")
        flash_detected = False
        for i in range(20):
            time.sleep(0.3)
            # Check if class present
            count = page.locator(".animate-flash-red").count()
            if count > 0:
                print(f"Detected red flash at frame {i}")
                page.screenshot(path="verification/3_red_flash_detected.png")
                flash_detected = True
                break

        if not flash_detected:
            print("Red flash not detected in time.")
            page.screenshot(path="verification/3_failed_flash.png")

        browser.close()

if __name__ == "__main__":
    verify_animations()
