
import asyncio
from playwright.async_api import async_playwright, expect
import json
import time
from datetime import datetime, timedelta

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--ignore-certificate-errors'])
        context = await browser.new_context(ignore_https_errors=True)
        page = await context.new_page()

        now = datetime.now()
        future = now + timedelta(minutes=30)

        commence_time = future.strftime("%Y-%m-%dT%H:%M:%SZ")

        yy = future.strftime("%y")
        mmm = future.strftime("%b").upper()
        dd = future.strftime("%d")
        date_part = f"{yy}{mmm}{dd}"

        home = "Kansas City Chiefs"
        away = "San Francisco 49ers"

        async def handle_odds(route):
            json_data = [
                {
                    "id": "test-game-1",
                    "sport_key": "americanfootball_nfl",
                    "commence_time": commence_time,
                    "home_team": home,
                    "away_team": away,
                    "bookmakers": [
                        {
                            "key": "fanduel",
                            "title": "FanDuel",
                            "last_update": commence_time,
                            "markets": [
                                {
                                    "key": "h2h",
                                    "outcomes": [
                                        {"name": home, "price": -110},
                                        {"name": away, "price": -110}
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
            await route.fulfill(json=json_data)

        async def handle_kalshi(route):
            ticker = f"KXNFLGAME-{date_part}-KC-SF-KC"
            json_data = {
                "markets": [
                    {
                        "ticker": ticker,
                        "event_ticker": f"KXNFLGAME-{date_part}-KC-SF",
                        "market_type": "h2h",
                        "yes_bid": 30,
                        "yes_ask": 40,
                        "volume": 1000,
                        "open_interest": 500
                    }
                ]
            }
            await route.fulfill(json=json_data)

        await page.route("**/odds/?regions=us&markets=h2h&oddsFormat=american&apiKey=*", handle_odds)
        await page.route("**/api/kalshi/markets?limit=300&status=open*", handle_kalshi)

        await context.add_init_script("sessionStorage.setItem('odds_api_key', 'test_key');")

        await page.goto("https://127.0.0.1:3000")

        await expect(page.get_by_role("row").filter(has_text="Kansas City")).to_be_visible(timeout=10000)
        row = page.get_by_role("row").filter(has_text="Kansas City")

        # Check Fair Value (should be 50)
        await expect(row).to_contain_text("50¢")

        # Check Max Limit column - Must be 38¢ (50 * (1 - 0.225))
        await expect(row).to_contain_text("38¢")

        print("Verification Successful: Max Limit is 38¢")

        await page.screenshot(path="verification/verify_timer.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
