from playwright.sync_api import sync_playwright, expect
import time

def verify_copy_logs_screenshot():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--ignore-certificate-errors"])
        page = browser.new_page(ignore_https_errors=True)

        try:
            page.goto("https://localhost:3000")

            # Wait for Event Log
            expect(page.get_by_text("Event Log")).to_be_visible(timeout=10000)

            # Locate the copy button
            copy_btn = page.get_by_label("Copy Logs")
            expect(copy_btn).to_be_visible()

            # Scroll to it
            copy_btn.scroll_into_view_if_needed()

            # Take screenshot of the "before click" state
            page.locator(".bg-white.rounded-xl.shadow-sm.border.border-slate-200.overflow-hidden.flex.flex-col.h-\[300px\]").screenshot(path="verification_screenshot.png")

            print("Screenshot saved to verification_screenshot.png")

        finally:
            browser.close()

if __name__ == "__main__":
    verify_copy_logs_screenshot()
