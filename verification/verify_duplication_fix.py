
import logging
import time
import os
import subprocess
from playwright.sync_api import sync_playwright, expect
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def run_repro_with_key(page, pem):
    page.on("console", lambda msg: logging.info(f"BROWSER: {msg.text}"))

    mock_position = {
        "ticker": "KX-TEST-23JAN01-T1",
        "market_ticker": "KX-TEST-23JAN01-T1",
        "position": 100,
        "avg_price": 50,
        "total_cost": 5000,
        "fees_paid": 10,
        "status": "active"
    }

    def handle_positions(route):
        logging.info("Intercepting /positions (unsettled)")
        route.fulfill(
            status=200,
            content_type="application/json",
            body='{"market_positions": [' + str(mock_position).replace("'", '"') + ']}'
        )

    def handle_settled_positions(route):
        logging.info("Intercepting /positions (settled)")
        route.fulfill(
            status=200,
            content_type="application/json",
            body='{"market_positions": [' + str(mock_position).replace("'", '"') + ']}'
        )

    page.route("**/portfolio/balance", lambda r: r.fulfill(status=200, body='{"balance": 100000}'))
    page.route("**/portfolio/orders", lambda r: r.fulfill(status=200, body='{"orders": []}'))

    page.route("**/*portfolio/positions?settlement_status=settled*", handle_settled_positions)
    page.route(lambda url: "positions" in url and "settled" not in url, handle_positions)


    logging.info("Navigating to dashboard...")
    page.goto("http://localhost:3000")

    logging.info("Injecting wallet keys...")
    pem_js = pem.replace('\n', '\\n')
    page.evaluate(f"""() => {{
        localStorage.setItem('kalshi_keys', JSON.stringify({{
            keyId: 'dummy-key-id',
            privateKey: `{pem_js}`
        }}));
    }}""")

    page.reload()

    logging.info("Waiting for dashboard...")
    page.wait_for_selector("text=Market Scanner", timeout=10000)

    logging.info("Clicking Positions tab...")
    page.get_by_role("button", name="positions").click()

    time.sleep(2)

    # Check for Rows
    # We look for rows that are item rows. They have class 'hover:bg-slate-50' (mapped in CSS as group?)
    # The code: className="hover:bg-slate-50 group"

    # We can also check that we have exactly 1 row with "T1" inside a specific column structure.

    rows = page.locator("tr.hover\\:bg-slate-50")
    count = rows.count()
    logging.info(f"Found Item Rows count: {count}")

    if count == 1:
        logging.info("NO DUPLICATION DETECTED! (SUCCESS)")
    elif count > 1:
        logging.info(f"Count is {count}. DUPLICATION DETECTED! (FAILURE)")
        raise Exception("Duplication detected.")
    else:
         logging.info(f"Count is {count}. Position missing?")
         raise Exception("Position missing.")

if __name__ == "__main__":
    try:
        subprocess.run(["pkill", "-f", "vite"], check=False)
    except:
        pass

    logging.info("Starting Dev Server...")
    env = os.environ.copy()

    server_process = subprocess.Popen(
        ["npm", "run", "dev", "--", "--port", "3000"],
        cwd="kalshi-dashboard",
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    time.sleep(10) # Wait for Vite

    try:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        ).decode('utf-8')

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            run_repro_with_key(page, pem)

    except Exception as e:
        logging.error(f"Verification failed: {e}")
        raise e
    finally:
        server_process.terminate()
