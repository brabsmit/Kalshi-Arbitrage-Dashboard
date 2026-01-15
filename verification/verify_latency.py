from playwright.sync_api import sync_playwright, expect
import time

def verify_latency_display():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--ignore-certificate-errors'])
        context = browser.new_context(ignore_https_errors=True)

        # Inject API key into session storage to bypass key check and allow scanning
        context.add_init_script("""
            window.sessionStorage.setItem('odds_api_key', 'test_key');
            window.localStorage.setItem('odds_api_key', 'test_key');

            // Mock fetch to return some markets so we can see the LatencyDisplay
            const originalFetch = window.fetch;
            window.fetch = async (url, options) => {
                if (url.includes('api.the-odds-api.com')) {
                    return {
                        ok: true,
                        json: async () => ([
                            {
                                id: 'game1',
                                sport_key: 'americanfootball_nfl',
                                commence_time: new Date(Date.now() + 3600000).toISOString(),
                                home_team: 'Team A',
                                away_team: 'Team B',
                                bookmakers: [{
                                    key: 'draftkings',
                                    title: 'DraftKings',
                                    last_update: new Date().toISOString(),
                                    markets: [{
                                        key: 'h2h',
                                        outcomes: [
                                            {name: 'Team A', price: -110},
                                            {name: 'Team B', price: -110}
                                        ]
                                    }]
                                }]
                            }
                        ]),
                        headers: { get: () => '100' }
                    };
                }
                if (url.includes('/api/kalshi/markets')) {
                    return {
                        ok: true,
                        json: async () => ({ markets: [] })
                    };
                }
                return originalFetch(url, options);
            };
        """)

        page = context.new_page()
        try:
            page.goto("https://127.0.0.1:3000", timeout=10000)
        except Exception:
            time.sleep(2)
            page.goto("https://127.0.0.1:3000")

        # Wait for app
        expect(page.get_by_text("Kalshi ArbBot")).to_be_visible()

        # The mock should populate markets. Wait for "Scanning markets..." to be gone.
        # It might take a few seconds for the "fetch" loop to trigger.
        # We can also force a refresh by clicking specific buttons if needed, but auto-scan should pick it up.

        # Wait for at least one market row to appear
        # The MarketRow contains the text "Team A"
        try:
            expect(page.get_by_text("Team A")).to_be_visible(timeout=10000)
        except AssertionError:
            print("Market not found yet. Taking screenshot anyway.")

        # Take screenshot of the table which should contain LatencyDisplay
        page.screenshot(path="/app/verification/latency_check.png")
        print("Screenshot taken at /app/verification/latency_check.png")

if __name__ == "__main__":
    verify_latency_display()
