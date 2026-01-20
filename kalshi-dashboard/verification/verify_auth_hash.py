from playwright.sync_api import sync_playwright, expect
import os
import time

def verify_auth_hash():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))
        page.on("pageerror", lambda err: print(f"Browser Error: {err}"))

        print("Navigating to app...")
        try:
            page.goto("https://localhost:3000", timeout=60000)
        except Exception as e:
            print(f"Error navigating: {e}")
            return

        # Wait for "Enter Password" label or "Unlock Dashboard" button
        print("Waiting for auth screen...")
        try:
            # Check for the error message first in case of misconfiguration
            if page.locator("text=Configuration error").is_visible():
                print("Configuration error detected on screen.")

            page.wait_for_selector("text=Enter Password", timeout=10000)
        except:
            print("Auth screen not found or timed out.")
            # Check what's on the page
            print("Page title:", page.title())
            if page.get_by_text("Kalshi ArbBot").is_visible():
                print("Appears to be already in dashboard.")
            elif page.get_by_text("Configuration error").is_visible():
                print("App is showing configuration error.")
            else:
                print("Unknown state. Content snippet:", page.content()[:200])

            # If we see config error, we might want to fail or just report it
            # For now, let's assume we want to proceed to test auth
            return

        # Test Incorrect Password
        print("Testing incorrect password...")
        page.fill("input[type='password']", "wrongpassword")
        page.click("button:has-text('Unlock Dashboard')")

        # Wait for error message
        try:
            expect(page.get_by_text("Incorrect password")).to_be_visible(timeout=5000)
            print("Incorrect password handled correctly.")
        except:
            print("Did not see 'Incorrect password' error.")

        # Clear input (or just overwrite)
        page.fill("input[type='password']", "")

        # Test Correct Password
        print("Testing correct password 'kalshi'...")
        page.fill("input[type='password']", "kalshi")
        page.click("button:has-text('Unlock Dashboard')")

        # Expect Dashboard
        print("Waiting for dashboard...")
        try:
            # Check if we moved past the auth screen
            # If the app crashes, the auth screen should still be gone
            expect(page.locator("text=Enter Password")).not_to_be_visible(timeout=10000)
            print("Verification successful! Passed auth screen.")
        except:
            print("Failed. Auth screen still visible.")
            if page.get_by_text("Incorrect password").is_visible():
                print("Still showing 'Incorrect password'.")

        browser.close()

if __name__ == "__main__":
    verify_auth_hash()
