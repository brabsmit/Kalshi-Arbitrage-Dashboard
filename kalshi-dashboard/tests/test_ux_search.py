import pytest
import json
from playwright.sync_api import expect

def generate_search_markets():
    return {
        "markets": [
            {
                "ticker": "KXNFL-23OCT08-DAL-SF",
                "event_ticker": "NFL-23OCT08-DAL-SF",
                "market_type": "Game",
                "game_id": "401547462",
                "status": "active",
                "open_interest": 100,
                "volume": 500,
                "yes_bid": 45,
                "yes_ask": 48,
                "expiration_time": "2023-10-09T03:00:00Z",
                "close_time": "2023-10-09T00:20:00Z",
                "commence_time": "2023-10-09T00:20:00Z",
                "title": "Cowboys vs 49ers",
                "subtitle": "Winner",
                "category": "Sports",
                "series_ticker": "KXNFL"
            },
            {
                "ticker": "KXNFL-23OCT08-KC-MIN",
                "event_ticker": "NFL-23OCT08-KC-MIN",
                "market_type": "Game",
                "game_id": "401547460",
                "status": "active",
                "open_interest": 200,
                "volume": 600,
                "yes_bid": 55,
                "yes_ask": 58,
                "expiration_time": "2023-10-08T23:00:00Z",
                "close_time": "2023-10-08T20:25:00Z",
                "commence_time": "2023-10-08T20:25:00Z",
                "title": "Chiefs vs Vikings",
                "subtitle": "Winner",
                "category": "Sports",
                "series_ticker": "KXNFL"
            }
        ]
    }

def generate_odds_response():
    return [
        {
            "id": "e1",
            "sport_key": "americanfootball_nfl",
            "sport_title": "NFL",
            "commence_time": "2023-10-09T00:20:00Z",
            "home_team": "San Francisco 49ers",
            "away_team": "Dallas Cowboys",
            "bookmakers": [
                {
                    "key": "fanduel",
                    "title": "FanDuel",
                    "last_update": "2023-10-08T12:00:00Z",
                    "markets": [
                        {
                            "key": "h2h",
                            "outcomes": [
                                {"name": "Dallas Cowboys", "price": 150},
                                {"name": "San Francisco 49ers", "price": -180}
                            ]
                        }
                    ]
                }
            ]
        },
        {
            "id": "e2",
            "sport_key": "americanfootball_nfl",
            "sport_title": "NFL",
            "commence_time": "2023-10-08T20:25:00Z",
            "home_team": "Minnesota Vikings",
            "away_team": "Kansas City Chiefs",
            "bookmakers": [
                {
                    "key": "fanduel",
                    "title": "FanDuel",
                    "last_update": "2023-10-08T12:00:00Z",
                    "markets": [
                        {
                            "key": "h2h",
                            "outcomes": [
                                {"name": "Kansas City Chiefs", "price": -150},
                                {"name": "Minnesota Vikings", "price": 130}
                            ]
                        }
                    ]
                }
            ]
        }
    ]

def test_market_search(authenticated_page):
    page = authenticated_page

    # Mock responses
    page.route("**/api/kalshi/markets*", lambda route: route.fulfill(json=generate_search_markets()))

    # Mock Sports List
    page.route("**/v4/sports/?apiKey*", lambda route: route.fulfill(json=[
        {"key": "americanfootball_nfl", "title": "NFL", "active": True}
    ]))

    # Mock Odds
    page.route("**/v4/sports/*/odds/*", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(generate_odds_response())
    ))

    # Mock other endpoints to prevent errors
    page.route("**/api/kalshi/portfolio/balance", lambda route: route.fulfill(json={"balance": 50000}))
    page.route("**/api/kalshi/portfolio/orders*", lambda route: route.fulfill(json={"orders": []}))
    page.route("**/api/kalshi/portfolio/positions*", lambda route: route.fulfill(json={"market_positions": []}))

    page.reload()

    # Find search input (verify UI rendered)
    search_input = page.get_by_placeholder("Search events...")
    expect(search_input).to_be_visible(timeout=10000)

    # Wait for markets to load
    cowboys_row = page.get_by_text("Dallas Cowboys", exact=False)
    chiefs_row = page.get_by_text("Kansas City Chiefs", exact=False)

    expect(cowboys_row).to_be_visible(timeout=10000)
    expect(chiefs_row).to_be_visible()

    # Filter for "Cowboys"
    search_input.fill("Cowboys")

    # Assert Cowboys are visible, Chiefs are hidden
    expect(cowboys_row).to_be_visible()
    expect(chiefs_row).not_to_be_visible()

    # Filter for "Chiefs"
    search_input.fill("Chiefs")
    expect(chiefs_row).to_be_visible()
    expect(cowboys_row).not_to_be_visible()

    # Clear search
    page.get_by_label("Clear search").click()

    # Assert both visible
    expect(cowboys_row).to_be_visible()
    expect(chiefs_row).to_be_visible()
