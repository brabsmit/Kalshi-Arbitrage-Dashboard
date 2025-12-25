from playwright.sync_api import sync_playwright

def verify_schedule_modal():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use ignore_https_errors because dev server uses self-signed cert
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        try:
            # Navigate to the dashboard
            page.goto("https://localhost:3000")

            # Open the Schedule Modal
            page.get_by_role("button", name="Run Schedule").click()

            # Wait for modal to be visible
            page.get_by_text("Schedule Run").wait_for()

            # Hover over a day button to show tooltip title
            sunday_btn = page.get_by_label("Sunday", exact=True)
            sunday_btn.hover()

            # Take a screenshot of the modal
            screenshot_path = "/app/verification/schedule_modal.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_schedule_modal()
