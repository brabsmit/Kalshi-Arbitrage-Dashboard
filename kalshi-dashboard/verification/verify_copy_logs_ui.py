from playwright.sync_api import sync_playwright, expect
import sys

def test_copy_logs_ui():
    with sync_playwright() as p:
        # Launch browser (headless by default)
        browser = p.chromium.launch(args=["--ignore-certificate-errors"])
        # Create a new page, ignore https errors
        page = browser.new_page(ignore_https_errors=True)

        try:
            # Go to the local dev server - using HTTPS
            page.goto("https://localhost:3000")

            # Wait for the Event Log header to verify we are on the page
            expect(page.get_by_text("Event Log")).to_be_visible(timeout=10000)

            # Look for the Copy Logs button
            # It should be an icon button, likely with aria-label="Copy Logs"
            copy_button = page.get_by_label("Copy Logs")

            # Check if it exists
            if copy_button.count() > 0 and copy_button.is_visible():
                print("SUCCESS: Copy Logs button found.")
            else:
                print("FAILURE: Copy Logs button not found.")
                sys.exit(1) # Exit with error code to signal failure

        except Exception as e:
            print(f"ERROR: {e}")
            sys.exit(1)
        finally:
            browser.close()

if __name__ == "__main__":
    test_copy_logs_ui()
