
import logging
import time
import os
import subprocess
from playwright.sync_api import sync_playwright, expect

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def run_verification(page):
    page.on("console", lambda msg: logging.info(f"BROWSER: {msg.text}"))
    page.on("pageerror", lambda err: logging.error(f"BROWSER ERROR: {err}"))

    # Network logging
    def log_response(route):
        try:
            response = route.fetch()
            url = route.request.url
            if "positions" in url:
                try:
                    data = response.json()
                    logging.info(f"NETWORK RESPONSE {url}: {data}")
                except:
                    logging.info(f"NETWORK RESPONSE {url}: {response.text()[:200]}")
            route.fulfill(response=response)
        except Exception as e:
            logging.error(f"Network log error: {e}")
            route.continue_()

    page.route("**/portfolio/positions*", log_response)

    logging.info("Navigating to dashboard...")
    page.goto("http://localhost:3000")

    page.wait_for_selector("text=Connect Wallet", timeout=10000)

    with open("kalshi-dashboard/.secrets/demo_key_id", "r") as f:
        key_id = f.read().strip()
    with open("kalshi-dashboard/.secrets/demo_private.key", "r") as f:
        private_key = f.read().strip()

    private_key_js = private_key.replace('\n', '\\n')

    logging.info("Injecting wallet keys...")
    page.evaluate(f"""() => {{
        localStorage.setItem('kalshi_keys', JSON.stringify({{
            keyId: '{key_id}',
            privateKey: `{private_key_js}`
        }}));
    }}""")

    logging.info("Reloading page...")
    page.reload()

    logging.info("Waiting for connection...")
    page.wait_for_selector("text=Wallet Active", timeout=20000)
    logging.info("Wallet connected.")

    time.sleep(5)

    failures = []

    # RESTING
    try:
        logging.info("Verifying RESTING tab...")
        page.get_by_role("button", name="resting").click()
        time.sleep(2)
        expect(page.locator("text=No items found")).not_to_be_visible(timeout=10000)
        logging.info("Resting tab has items (SUCCESS).")
    except Exception as e:
        logging.error(f"Resting tab check failed: {e}")
        failures.append("resting")

    # POSITIONS
    try:
        logging.info("Verifying POSITIONS tab...")
        page.get_by_role("button", name="positions").click()
        time.sleep(2)
        expect(page.locator("text=No items found")).not_to_be_visible(timeout=10000)
        logging.info("Positions tab has items (SUCCESS).")
    except Exception as e:
        logging.error(f"Positions tab check failed: {e}")
        failures.append("positions")

    # HISTORY
    try:
        logging.info("Verifying HISTORY tab...")
        page.get_by_role("button", name="history").click()
        time.sleep(2)
        expect(page.locator("text=No items found")).not_to_be_visible(timeout=10000)
        logging.info("History tab has items (SUCCESS).")
    except Exception as e:
        logging.error(f"History tab check failed: {e}")
        failures.append("history")

    if failures:
        raise Exception(f"Tabs failed: {failures}")

if __name__ == "__main__":
    try:
        subprocess.run(["pkill", "-f", "vite"], check=False)
    except:
        pass

    logging.info("Starting Dev Server with Demo API...")
    env = os.environ.copy()
    env["KALSHI_API_URL"] = "https://demo-api.kalshi.co"

    server_process = subprocess.Popen(
        ["node", "./node_modules/vite/bin/vite.js", "--port", "3000"],
        cwd="kalshi-dashboard",
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    time.sleep(10)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        try:
            run_verification(page)
        except Exception as e:
            logging.error(f"Verification failed: {e}")
            raise e
        finally:
            browser.close()
            server_process.terminate()
