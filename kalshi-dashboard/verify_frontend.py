from playwright.sync_api import sync_playwright, expect
import time

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Ignore HTTPS errors because of self-signed cert
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))

        # Bypass authentication
        page.add_init_script("sessionStorage.setItem('authenticated', 'true');")

        print("Navigating to app...")
        # Port changed to 3000 according to logs, and HTTPS is enabled
        page.goto("https://localhost:3000")

        # Wait for app to load
        print("Waiting for app to load...")
        page.wait_for_selector("text=Kalshi ArbBot", timeout=10000)

        # Verify signRequest works with native crypto
        print("Verifying signRequest logic...")
        # Generate a test key (PKCS#8)
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        ).decode('utf-8')

        # We need to escape newlines for JS string
        pem_js = pem.replace('\n', '\\n')

        signature = page.evaluate(f"""async () => {{
            const {{ signRequest }} = await import('/src/utils/core.js');
            try {{
                return await signRequest(`{pem_js}`, "GET", "/test", 1234567890);
            }} catch (e) {{
                return "ERROR: " + e.message;
            }}
        }}""")

        if str(signature).startswith("ERROR:"):
             print(f"FAILED: signRequest returned error: {signature}")
             exit(1)

        if not signature or len(signature) < 10:
             print(f"FAILED: Invalid signature length: {signature}")
             exit(1)

        print(f"SUCCESS: Generated signature: {signature[:20]}...")

        # Check for Market Scanner
        print("Checking Market Scanner...")
        expect(page.get_by_text("Market Scanner")).to_be_visible()

        # Check for "Sports" filter button
        print("Checking Sports Filter...")
        # The button shows "1 Sport" by default if one is selected
        filter_btn = page.locator("button[aria-label='Filter by Sport']")
        expect(filter_btn).to_be_visible()

        # Click the filter button to open dropdown
        print("Opening Filter Dropdown...")
        filter_btn.click()

        # Verify dropdown content (Sports list)
        # Assuming defaults are NFL, NBA, etc.
        # "Available Sports" is the text in the header of the dropdown
        expect(page.get_by_text("Available Sports")).to_be_visible()
        expect(page.get_by_text("Football (NFL)")).to_be_visible()
        expect(page.get_by_text("Basketball (NBA)")).to_be_visible()

        # Take screenshot of the open filter
        print("Taking screenshot...")
        page.screenshot(path="verification_screenshot.png")

        # Close browser
        browser.close()
        print("Verification complete.")

if __name__ == "__main__":
    verify_frontend()
