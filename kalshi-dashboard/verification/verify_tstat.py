from playwright.sync_api import sync_playwright, Page, expect
import json
import time

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))

    trade_history = {
        "TEST-MARKET-1": {
            "marketId": "TEST-MARKET-1",
            "orderPlacedAt": 1698300000000,
            "ticker": "TEST-MARKET-1",
            "event": "Test Event 1"
        },
        "TEST-MARKET-2": {
            "marketId": "TEST-MARKET-2",
            "orderPlacedAt": 1698300000000,
            "ticker": "TEST-MARKET-2",
            "event": "Test Event 2"
        },
        "TEST-MARKET-3": {
            "marketId": "TEST-MARKET-3",
            "orderPlacedAt": 1698300000000,
            "ticker": "TEST-MARKET-3",
            "event": "Test Event 3"
        }
    }

    init_script = f"""
        window.localStorage.setItem('kalshi_keys', '{json.dumps({"keyId": "test", "privateKey": "test"})}');
        window.localStorage.setItem('kalshi_trade_history', '{json.dumps(trade_history)}');

        window.forge = {{
            pki: {{ privateKeyFromPem: () => ({{ sign: () => 'sig' }}) }},
            md: {{ sha256: {{ create: () => ({{ update: () => {{}} }}) }} }},
            pss: {{ create: () => {{}} }},
            mgf: {{ mgf1: {{ create: () => {{}} }} }},
            util: {{ encode64: () => 'sig' }}
        }};
        console.log("INJECTED KEYS & FORGE");
    """

    page.add_init_script(init_script)

    positions_response = {
        "market_positions": [
            {
                "ticker": "TEST-MARKET-1",
                "position": 0,
                "settlement_status": "settled",
                "realized_pnl": 1000,
                "marketId": "TEST-MARKET-1"
            },
            {
                "ticker": "TEST-MARKET-2",
                "position": 0,
                "settlement_status": "settled",
                "realized_pnl": 1000,
                "marketId": "TEST-MARKET-2"
            },
            {
                "ticker": "TEST-MARKET-3",
                "position": 0,
                "settlement_status": "settled",
                "realized_pnl": 500,
                "marketId": "TEST-MARKET-3"
            }
        ]
    }

    page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(positions_response)
    ))

    page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(status=200, body='{"balance": 10000}'))
    page.route("**/api/kalshi/portfolio/orders", lambda route: route.fulfill(status=200, body='{"orders": []}'))
    page.route("**/api/kalshi/markets*", lambda route: route.fulfill(status=200, body='{"markets": []}'))
    page.route("**/api.the-odds-api.com/**", lambda route: route.fulfill(status=200, body='[]'))

    page.goto("http://localhost:3001")

    # Check storage
    keys = page.evaluate("localStorage.getItem('kalshi_keys')")
    print(f"KEYS IN STORAGE AFTER LOAD: {keys}")

    if not keys:
        print("Re-injecting keys...")
        page.evaluate(f"localStorage.setItem('kalshi_keys', '{json.dumps({'keyId': 'test', 'privateKey': 'test'})}')")
        page.reload()

    # Wait for UI update
    try:
        expect(page.get_by_text("+$25.00")).to_be_visible(timeout=5000)
    except:
        print("Timeout waiting for PnL. Taking debug screenshot.")
        page.screenshot(path="kalshi-dashboard/verification/debug_fail.png")
        raise

    expect(page.get_by_text("Statistical Sig.")).to_be_visible()
    expect(page.get_by_text("5.00", exact=True)).to_be_visible()
    expect(page.get_by_text("Significant", exact=False)).to_be_visible()

    page.screenshot(path="kalshi-dashboard/verification/tstat_verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
