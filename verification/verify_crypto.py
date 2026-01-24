import os
import shutil
import subprocess
import time
import sys
from playwright.sync_api import sync_playwright
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

def generate_key():
    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    return pem.decode('utf-8')

def setup_test_env():
    test_dir = "verification/crypto_test_env"
    if os.path.exists(test_dir):
        shutil.rmtree(test_dir)
    os.makedirs(test_dir)

    # Copy core.js
    shutil.copy("kalshi-dashboard/src/utils/core.js", f"{test_dir}/core.js")

    # Create index.html
    html_content = """
    <!DOCTYPE html>
    <html>
    <body>
    <script type="module">
        import { signRequest } from './core.js';

        window.runTest = async (pem) => {
            try {
                const signature = await signRequest(pem, "GET", "/test", Date.now());
                console.log("Signature generated:", signature);
                return signature;
            } catch (e) {
                console.error(e);
                return "ERROR: " + e.message;
            }
        };
    </script>
    </body>
    </html>
    """
    with open(f"{test_dir}/index.html", "w") as f:
        f.write(html_content)

    return test_dir

def run_server(test_dir, port=8001):
    # Start python server in background
    proc = subprocess.Popen([sys.executable, "-m", "http.server", str(port)], cwd=test_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1) # wait for start
    return proc

def verify():
    print("Setting up test environment...")
    test_dir = setup_test_env()

    print("Generating PKCS#8 Key...")
    pem_key = generate_key()

    print("Starting server...")
    server_proc = run_server(test_dir)

    try:
        with sync_playwright() as p:
            print("Launching browser...")
            browser = p.chromium.launch()
            page = browser.new_page()

            print("Navigating to test page...")
            page.goto("http://localhost:8001")

            print("Running signRequest...")
            # We pass the PEM key to the function exposed on window
            result = page.evaluate(f"window.runTest(`{pem_key}`)")

            print(f"Result: {result}")

            if "ERROR" in str(result):
                print("❌ Verification Failed: Error returned from browser")
                sys.exit(1)
            elif result and len(result) > 10:
                print("✅ Verification Passed: Signature generated successfully")
            else:
                print("❌ Verification Failed: Invalid result")
                sys.exit(1)

            browser.close()

    finally:
        server_proc.kill()
        # Clean up
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)

if __name__ == "__main__":
    verify()
