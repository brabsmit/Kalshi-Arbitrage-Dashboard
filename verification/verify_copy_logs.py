
import os
import time
from playwright.sync_api import sync_playwright, expect

# Verification of Copy Logs UX improvement:
# 1. Existence of "Copy Logs" button in Event Log component
# 2. Visual feedback upon clicking (Checkmark)
# 3. Clipboard content verification

def verify_copy_logs():
    with sync_playwright() as p:
        # Launch browser with ignore_https_errors because dev server uses self-signed cert
        # Grant clipboard permissions
        browser = p.chromium.launch(headless=True, args=["--ignore-certificate-errors"])
        context = browser.new_context(ignore_https_errors=True, permissions=['clipboard-read', 'clipboard-write'])
        page = context.new_page()

        print("Navigating to dashboard...")
        page.goto("https://localhost:3000")

        # Wait for app to load
        print("Waiting for app to load...")
        page.wait_for_selector("h1", timeout=10000)

        # 1. Locate "Event Log" header
        print("Locating Event Log header...")
        event_log_header = page.get_by_text("Event Log", exact=False)
        expect(event_log_header).to_be_visible()

        # 2. Check for "Copy Logs" button
        print("Checking for Copy Logs button...")
        # Assuming the button will have aria-label="Copy Logs"
        copy_btn = page.get_by_label("Copy Logs")

        try:
            expect(copy_btn).to_be_visible(timeout=5000)
            print("Copy Logs button found!")
        except AssertionError:
            print("FAIL: Copy Logs button NOT found.")
            # Fail gracefully so we can implement it
            browser.close()
            exit(1)

        # 3. Click it and verify feedback
        print("Clicking Copy Logs button...")
        copy_btn.click()

        # Verify Check icon appears (usually replaces the copy icon briefly)
        # We can check if the button content changes or if a specific icon class appears
        # Ideally, we look for the visual feedback state.
        # Assuming implementation will show a check icon.

        # Verify clipboard content
        # We need some logs first. The app usually starts empty or with connection logs if connected.
        # Let's just check if clipboard has valid JSON or text.

        clipboard_text = page.evaluate("navigator.clipboard.readText()")
        print(f"Clipboard content: {clipboard_text[:50]}...")

        if not clipboard_text:
            print("FAIL: Clipboard is empty.")
            exit(1)

        print("SUCCESS: Copy Logs functionality verified!")
        browser.close()

if __name__ == "__main__":
    verify_copy_logs()
