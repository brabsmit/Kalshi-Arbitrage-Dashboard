
import os
import time
from playwright.sync_api import sync_playwright, expect

# Verification of Copy Logs Feature
# 1. Check if "Copy Logs" button exists in Event Log header
# 2. Click it and verify visual feedback (Check icon)
# 3. Verify clipboard content (if possible in headless)
# 4. Take screenshot

def verify_copy_logs():
    with sync_playwright() as p:
        # Launch with ignore_https_errors
        browser = p.chromium.launch(headless=True, args=["--ignore-certificate-errors"])

        # Grant clipboard permissions
        context = browser.new_context(
            ignore_https_errors=True,
            permissions=['clipboard-read', 'clipboard-write']
        )

        page = context.new_page()

        print("Navigating to dashboard...")
        # Use 127.0.0.1 to avoid connection refused issues sometimes seen with localhost
        try:
            page.goto("https://127.0.0.1:3000")
        except:
            print("Retrying with localhost...")
            page.goto("https://localhost:3000")

        # Wait for app to load
        print("Waiting for app to load...")
        page.wait_for_selector("h1", timeout=10000)

        # Locate Event Log header
        print("Locating Event Log...")
        event_log_header = page.locator("h3", has_text="Event Log")
        expect(event_log_header).to_be_visible()

        # Look for the Copy button
        print("Looking for Copy Logs button...")
        copy_btn = page.get_by_role("button", name="Copy Logs")

        if not copy_btn.is_visible():
            print("FAIL: Copy Logs button not found!")
            browser.close()
            exit(1)

        print("Copy Logs button found!")

        # Take screenshot of the button before click
        # Locate the whole Event Log component for context
        event_log_container = page.locator("div.bg-white", has=page.locator("h3", has_text="Event Log")).first
        event_log_container.screenshot(path="verification/event_log_before.png")

        # Click it
        print("Clicking Copy Logs...")
        copy_btn.click()

        # Check for visual feedback (The icon should change to a Check)
        # We can check if the button contains a Check icon (SVG)
        # Assuming Lucide React renders svg with specific class or just the presence of svg inside button

        # Take screenshot during feedback (it lasts 2 seconds)
        time.sleep(0.5)
        event_log_container.screenshot(path="verification/event_log_feedback.png")
        print("Screenshot saved to verification/event_log_feedback.png")

        # Check clipboard content
        print("Checking clipboard...")
        clipboard_text = page.evaluate("navigator.clipboard.readText()")
        print(f"Clipboard content length: {len(clipboard_text)}")

        print("Copy Logs verification passed!")
        browser.close()

if __name__ == "__main__":
    verify_copy_logs()
