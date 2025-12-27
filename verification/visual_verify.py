
from playwright.sync_api import sync_playwright

def verify_sport_filter_visuals():
    with sync_playwright() as p:
        # Launch browser with ignore_https_errors since we use self-signed certs
        browser = p.chromium.launch(headless=True, args=["--ignore-certificate-errors"])
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        # Mock window.forge to prevent errors
        page.add_init_script("""
            window.forge = {
                pki: { privateKeyFromPem: () => ({ sign: () => 'sig' }) },
                md: { sha256: { create: () => ({ update: () => {} }) } },
                mgf: { mgf1: { create: () => {} } },
                pss: { create: () => {} },
                util: { encode64: () => 'encoded' }
            };
        """)

        # Set viewport to mobile size to verify responsive width
        page.set_viewport_size({"width": 375, "height": 667})

        try:
            print("Navigating to app...")
            page.goto("https://localhost:3000")
            page.wait_for_load_state("networkidle")

            print("Opening Sport Filter...")
            filter_btn = page.get_by_label("Filter by Sport")
            filter_btn.click()

            # Wait for dropdown animation
            page.wait_for_timeout(500)

            # Take screenshot
            screenshot_path = "verification/sport_filter_mobile.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_sport_filter_visuals()
