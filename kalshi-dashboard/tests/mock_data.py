# Mock data for Kalshi API

MOCK_BALANCE = {
    "balance": 1000000 # 10,000.00 USD
}

MOCK_MARKETS = {
    "markets": [
        {
            "ticker": "KXNFLGAME-23OCT26-BUF-TB",
            "event_ticker": "NFL-23OCT26-BUF-TB",
            "yes_bid": 60,
            "yes_ask": 65,
            "volume": 1000,
            "open_interest": 500,
            "status": "active"
        },
        {
            "ticker": "KXNBAGAME-23OCT26-LAL-PHX",
            "event_ticker": "NBA-23OCT26-LAL-PHX",
            "yes_bid": 45,
            "yes_ask": 50,
            "volume": 2000,
            "open_interest": 800,
            "status": "active"
        }
    ]
}

MOCK_ORDERS = {
    "orders": [
        {
            "order_id": "ord_123",
            "ticker": "KXNFLGAME-23OCT26-BUF-TB",
            "side": "yes",
            "count": 10,
            "fill_count": 0,
            "remaining_count": 10,
            "yes_price": 50,
            "status": "resting",
            "created_time": "2023-10-26T12:00:00Z",
            "expiration_time": "2023-10-26T23:59:59Z"
        }
    ]
}

MOCK_POSITIONS = {
    "market_positions": [
        {
            "ticker": "KXNBAGAME-23OCT26-LAL-PHX",
            "market_ticker": "KXNBAGAME-23OCT26-LAL-PHX",
            "position": 50,
            "avg_price": 40,
            "total_cost": 2000,
            "fees_paid": 20,
            "realized_pnl": 0,
            "settlement_status": "unsettled"
        }
    ]
}

MOCK_HISTORY = {
    "market_positions": [
         {
            "ticker": "KXNBAGAME-23OCT20-LAL-DEN",
            "market_ticker": "KXNBAGAME-23OCT20-LAL-DEN",
            "position": 0,
            "avg_price": 30,
            "total_cost": 1500,
            "fees_paid": 15,
            "realized_pnl": 500,
            "settlement_status": "settled"
        }
    ]
}

MOCK_ORDER_RESPONSE = {
    "order_id": "ord_new_456",
    "status": "placed"
}
