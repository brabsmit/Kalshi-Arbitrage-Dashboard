
import time
from playwright.sync_api import sync_playwright

def verify():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        url = "https://localhost:3001"
        try:
            print(f"Navigating to {url}")
            page.goto(url)
            # Wait for app to load
            page.wait_for_selector("header", timeout=30000)
        except Exception:
            print("Retrying on port 3000...")
            url = "https://localhost:3000"
            page.goto(url)
            page.wait_for_selector("header", timeout=30000)

        try:
            # Locate the Sport Filter button
            filter_btn = page.locator("button:has-text('Sport')").first

            if not filter_btn.is_visible():
                filter_btn = page.locator("button:has(svg.lucide-trophy)")

            filter_btn.wait_for(state="visible", timeout=10000)
            print(f"Found Sport Filter button: '{filter_btn.inner_text()}'")

            # Check for attributes
            expanded = filter_btn.get_attribute("aria-expanded")
            haspopup = filter_btn.get_attribute("aria-haspopup")
            controls = filter_btn.get_attribute("aria-controls")

            print(f"aria-expanded: {expanded}")
            print(f"aria-haspopup: {haspopup}")
            print(f"aria-controls: {controls}")

            if expanded is None:
                print("FAIL: aria-expanded is missing")
                return False

            if haspopup != "true" and haspopup != "dialog" and haspopup != "listbox" and haspopup != "menu":
                print(f"FAIL: aria-haspopup is invalid or missing: {haspopup}")
                return False

            if not controls:
                 print("FAIL: aria-controls is missing")
                 return False

            print("Clicking button...")
            filter_btn.click()
            time.sleep(0.5)

            expanded_after = filter_btn.get_attribute("aria-expanded")
            print(f"aria-expanded (after click): {expanded_after}")

            if expanded_after != "true":
                 print("FAIL: aria-expanded did not become true")
                 return False

            # Check dropdown using attribute selector to handle special chars like ':' from useId
            dropdown_id = controls
            if not dropdown_id:
                print("FAIL: aria-controls missing, cannot find dropdown by ID")
                return False

            dropdown = page.locator(f"[id='{dropdown_id}']")
            if not dropdown.is_visible():
                print("FAIL: Dropdown not visible")
                return False

            role = dropdown.get_attribute("role")
            if role != "dialog":
                print(f"FAIL: Dropdown role is {role}, expected 'dialog'")
                return False

            print("SUCCESS: All checks passed")
            return True

        except Exception as e:
            print(f"ERROR: {e}")
            return False
        finally:
            browser.close()

if __name__ == "__main__":
    success = verify()
    if not success:
        exit(1)
