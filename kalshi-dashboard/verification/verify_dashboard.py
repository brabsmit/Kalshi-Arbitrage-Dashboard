from playwright.sync_api import sync_playwright
import time

def verify_dashboard():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Inject mock credentials
        page.add_init_script("""
            localStorage.setItem('kalshi_keys', JSON.stringify({
                keyId: 'test_key',
                privateKey: '-----BEGIN PRIVATE KEY-----\\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCyBLCB9F+FDbPl\\ngjpgeqQ7JRR4W3avzPuKALBasY1RTVLK4V05f1a/3FnUZ7EJoXe5G+yMftWrhHJM\\nsfroejiNnW7/SH95XjxvQZr98LlYuFg1cfOYPtI4g2W9u2e8dh9D1jtg7WMahAPA\\ne3OwQy7LMp2WuGOZJHislYfh5pE9VhQpSGCKZK88TXC+M1QTXBnAXtItcJrgr0IC\\nz42sZ1T0FPF1W89MioVoPHw9quYJdGqoPqzQZMun3lNcHPREJvg1kBSFtEquqs1u\\nwEwfh+BUqaDESpan6299SuA9VYiirHEkinlvpR3ZTQ74I/SDAEmyJuxHRcgnoEpV\\nL/qAKEWHAgMBAAECggEAFX0ZbWZ5TU9dItw4fcLwJi+QrAKmbgw5ZOw2XYxHOcQy\\ntUjE/xbO+vP3Z/toVHhIQnELed4pnr2rKnTli8CNKRMS/f/bW2QzuV5a/kJbrUj7\\nZOAvfnY+3BGIa4G+wPIlTgQDQO0G5IGBDnAYg/NoJ6EhgrsZUrgjVPnr4Cn76EJT\\nLDDe0xOv3DwK6h1aleDUSr5Yj8eaqgEIGI/k4vd3c/4EWrZJXebEBgervp/nviXC\\nmF13/Wy0vDhNVHaucAV2OtnfjlSkbKJvW/J9y41t/AuXiAZ6ipqTBorVTxk3X6FE\\n8USfs4IO7grVR8o4mWX7STNfjhxC2Ulx2KAgm14mEQKBgQDgdRXdGdS+D80lUamO\\nOwYp55fI7daaGKR1ursKr7EyPuYBK53aKIpy1+dxDULcJ5WM+2tgzoZdWgtUY1/f\\n3aXyUHtihRnNT8H0yvHL8gfnaypGif0ghtNYIK3cVxwUj7q/02pBlK7AhRaW699s\\nQ6u4X058rOIIwM/DB5nM7ps3jwKBgQDLCPJgGrHTNgSkaK28CE/plTBsO89h+J/Y\\nTN6mbQWIj+v5fLAzuAK6fImrGkiSokybZdNRWaOYX9j2/H3y0gHXD06r2Ox3Lld8\\nPVwVhIqBGZkf7Wo2DcV89+ngA6ewTQq4hArL/sKjnJPRLfh5PqHJ8p4p2gPuVpe7\\nf1tv4/rWiQKBgBmoyOsRvORNYiJWB5Ae50F7HDr4FYRgNMzQn/lExHj9/8U6ez0p\\nTUp7rBWccnxAejQ3ubrDYVDirlDjW154NDRTRweoN57k80NMv/+Ul5q5AYg21h0V\\nzKtScQ2zV55yH+M2A/ujR6byj/aI2G3D/qmBG7Pc/6oIgLfG8qoezNe5AoGAcvun\\nIAweJwpRiLaLpZBjiVpnKPSaVtaR19J4yXG2j4dKUWlu9GtCiFBdOtxQu1JU5jC9\\ngzWrs3CclAucXHbYee3+VM4t5LUG8KJjUwBT3BceI/m1i9Uywbo45hfL0Mlgx+xn\\nnO2zVysmf3F0ZV22DINtVTBVx5Wcqp/OrchD11kCgYB6bF+LtvY5Kixf+KX8Rxoc\\nlnAfoaF47SQCVbdooOO2YyFig4cVKP43BRrOsTfdhzNi3OGkTMSxm8AZWOkSYBUw\\nsdE/KuZECWlhu20rrU8JBHy9ofbaJnaAgaVj9f5V2FY5RKlU8CpOnpRRtuCd8YGq\\nCtHoEs5ra5IaGxxb413soA==\\n-----END PRIVATE KEY-----'
            }));
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
