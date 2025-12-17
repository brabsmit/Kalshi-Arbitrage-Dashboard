
import os
import json
import time
import base64
import requests
import asyncio
import websockets
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives import serialization

# --- CONFIG ---
API_URL = "https://demo-api.kalshi.co/trade-api/v2"
WS_URL = "wss://demo-api.kalshi.co/trade-api/ws/v2"

# Get keys from env
KEY_ID = os.environ.get("KALSHI_DEMO_API_KEY_ID")
PRIVATE_KEY_PEM = os.environ.get("KALSHI_DEMO_API_KEY")

if not KEY_ID or not PRIVATE_KEY_PEM:
    print("Skipping test: Missing credentials")
    exit(0)

def sign_request(method, path, timestamp):
    # Load Private Key
    private_key = serialization.load_pem_private_key(
        PRIVATE_KEY_PEM.encode(),
        password=None
    )

    # Prepare Message
    msg = f"{timestamp}{method}{path}".encode('utf-8')

    # Sign
    signature = private_key.sign(
        msg,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=32
        ),
        hashes.SHA256()
    )

    return base64.b64encode(signature).decode('utf-8')

def get_markets():
    ts = str(int(time.time() * 1000))
    path = "/markets"
    sig = sign_request("GET", path, ts)
    headers = {
        "KALSHI-ACCESS-KEY": KEY_ID,
        "KALSHI-ACCESS-SIGNATURE": sig,
        "KALSHI-ACCESS-TIMESTAMP": ts
    }
    res = requests.get(f"{API_URL}{path}?limit=10&status=open", headers=headers)
    if res.status_code != 200:
        print(f"Failed to fetch markets: {res.text}")
        return []
    return res.json().get("markets", [])

async def test_ws():
    markets = get_markets()
    if not markets:
        print("No markets found")
        return

    # Pick 3 tickers
    tickers = [m['ticker'] for m in markets[:3]]
    print(f"Testing subscription for: {tickers}")

    ts = str(int(time.time() * 1000))
    path = "/trade-api/ws/v2"
    sig = sign_request("GET", path, ts)

    extra_headers = {
        "KALSHI-ACCESS-KEY": KEY_ID,
        "KALSHI-ACCESS-SIGNATURE": sig,
        "KALSHI-ACCESS-TIMESTAMP": ts
    }

    async with websockets.connect(WS_URL, additional_headers=extra_headers) as websocket:
        print("Connected to WS")

        # Subscribe
        msg = {
            "id": 1,
            "cmd": "subscribe",
            "params": {
                "channels": ["ticker"],
                "market_tickers": tickers
            }
        }
        await websocket.send(json.dumps(msg))
        print("Sent subscription")

        received = set()
        start_time = time.time()

        while time.time() - start_time < 10: # Listen for 10 seconds
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=1.0)
                data = json.loads(message)
                # print(data)

                if data.get("type") == "ticker":
                    ticker = data["msg"]["ticker"]
                    print(f"Received update for {ticker}")
                    received.add(ticker)

                if len(received) == len(tickers):
                    print("SUCCESS: Received updates for all tickers")
                    break
            except asyncio.TimeoutError:
                continue

        print(f"Received {len(received)}/{len(tickers)} tickers")
        if len(received) < len(tickers):
            print("FAILED: Did not receive updates for all tickers (Note: Markets might be quiet)")

if __name__ == "__main__":
    asyncio.run(test_ws())
