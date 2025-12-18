import os
import time
import base64
import json
import requests
import uuid
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives import serialization

# Configuration
API_URL = "https://demo-api.kalshi.co/trade-api/v2"
KEY_ID = os.environ.get("KALSHI_DEMO_API_KEY_ID")
PRIVATE_KEY_PEM = os.environ.get("KALSHI_DEMO_API_KEY")

if not KEY_ID or not PRIVATE_KEY_PEM:
    print("Error: Missing credentials")
    exit(1)

# Load Private Key
try:
    private_key = serialization.load_pem_private_key(
        PRIVATE_KEY_PEM.encode(),
        password=None
    )
except Exception as e:
    # Try fixing newlines
    try:
        fixed_pem = PRIVATE_KEY_PEM.replace(' KEY----- ', ' KEY-----\n').replace(' -----END', '\n-----END').replace(' ', '\n')
        private_key = serialization.load_pem_private_key(
             fixed_pem.encode(),
             password=None
        )
    except Exception as e2:
        exit(1)

def sign_request(method, path, timestamp):
    clean_path = path.split('?')[0]
    msg = f"{timestamp}{method}{clean_path}"

    signature = private_key.sign(
        msg.encode('utf-8'),
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=32
        ),
        hashes.SHA256()
    )
    return base64.b64encode(signature).decode('utf-8')

def make_request(method, endpoint, body=None):
    ts = str(int(time.time() * 1000))
    path = f"/trade-api/v2{endpoint}"
    sig = sign_request(method, path, ts)

    headers = {
        "Content-Type": "application/json",
        "KALSHI-ACCESS-KEY": KEY_ID,
        "KALSHI-ACCESS-SIGNATURE": sig,
        "KALSHI-ACCESS-TIMESTAMP": ts
    }

    url = f"{API_URL}{endpoint}"
    print(f"\n{method} {url}")

    try:
        if body:
            response = requests.request(method, url, headers=headers, json=body)
        else:
            response = requests.request(method, url, headers=headers)

        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
        return response
    except Exception as e:
        print(f"Request failed: {e}")
        return None

def main():
    # Try to DELETE a random UUID
    random_id = str(uuid.uuid4())
    print(f"\nAttempting DELETE /portfolio/orders/{random_id} (Non-existent)...")
    res = make_request("DELETE", f"/portfolio/orders/{random_id}")

    if res.status_code == 404:
        print("CONFIRMED: Kalshi returns 404 for non-existent orders.")
    else:
        print(f"Unexpected status for non-existent order: {res.status_code}")

if __name__ == "__main__":
    main()
