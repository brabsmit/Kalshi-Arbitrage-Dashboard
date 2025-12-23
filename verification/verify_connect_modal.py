from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        try:
            # Retry connection a few times if server is warming up
            for i in range(5):
                try:
                    page.goto("https://localhost:3000", timeout=5000)
                    break
                except Exception:
                    print(f"Waiting for server... ({i+1}/5)")
                    time.sleep(2)

            # Open Connect Modal
            connect_btn = page.get_by_role("button", name="Connect Wallet")
            expect(connect_btn).to_be_visible()
            connect_btn.click()

            # Wait for modal content
            expect(page.get_by_text("Connect Kalshi API")).to_be_visible()

            # Hover over the drop zone to show hover state in screenshot (optional/tricky in static shot)
            # drop_zone = page.locator('input[type="file"]').locator("..")
            # drop_zone.hover()

            # Take screenshot of the modal
            # We can locate the modal dialog
            modal = page.locator(".fixed.inset-0")
            modal.screenshot(path="verification/connect_modal.png")
            print("Screenshot saved to verification/connect_modal.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
