    # Mock Orders (Shared Capture)
    captured_orders = []
    def handle_orders(route):
        print(f"HANDLE ORDERS CALLED: {route.request.method} {route.request.url}")
        if route.request.method == "GET":
             route.fulfill(json={"orders": []})
        elif route.request.method == "POST":
             data = route.request.post_data_json
             print(f"Intercepted POST Order: {data}")
             captured_orders.append(data)
             route.fulfill(json={"order_id": f"ord_{len(captured_orders)}", "status": "placed"})
        else:
             route.continue_()

    page.route("**/api/kalshi/portfolio/orders*", handle_orders)
