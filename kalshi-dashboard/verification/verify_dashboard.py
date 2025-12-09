from playwright.sync_api import sync_playwright
import time
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

def generate_mock_key():
    """Generates a temporary RSA private key for testing."""
    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    return pem.decode('utf-8').replace('\n', '\\n')

def verify_dashboard():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        mock_key = generate_mock_key()

        # Inject mock credentials
        page.add_init_script(f"""
            localStorage.setItem('kalshi_keys', JSON.stringify({{
                keyId: 'test_key',
                privateKey: `{mock_key}`
            }}));
            localStorage.setItem('odds_api_key', 'mock_odds');
        """)

        # Navigate
        page.goto("http://localhost:3000")

        # Wait for load
        time.sleep(2)

        # Take screenshot
        page.screenshot(path="verification/dashboard_view.png")
        browser.close()

if __name__ == "__main__":
    verify_dashboard()
