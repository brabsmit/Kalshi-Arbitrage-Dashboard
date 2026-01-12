
import pytest
from playwright.sync_api import sync_playwright

def test_csp_verification():
    """
    Verifies that the application loads without CSP violations in production preview.
    Assumes 'pnpm preview' is running on port 4173 (HTTPS).
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--ignore-certificate-errors'])
        page = browser.new_context(ignore_https_errors=True).new_page()

        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

        # Navigate to the preview server
        try:
            # Note: Vite basicSsl plugin makes it HTTPS
            page.goto("https://localhost:4173")
            page.wait_for_selector("body", timeout=5000)

            # Check for CSP violation reports in console
            csp_violations = [err for err in console_errors if "Content Security Policy" in err]

            if csp_violations:
                print(f"CSP Violations found: {csp_violations}")
                assert False, f"CSP Violations detected: {csp_violations}"
            else:
                print("No CSP violations detected.")

            # Verify basic interactivity to ensure app is running
            # Check if root div exists (content might be empty if no API keys, but root should exist)
            assert page.query_selector("#root")

            # Verify meta tag is present and correct
            meta_csp = page.eval_on_selector("meta[http-equiv='Content-Security-Policy']", "el => el.content")
            print(f"CSP Meta Tag: {meta_csp}")
            assert "script-src 'self';" in meta_csp
            assert "unsafe-inline" not in meta_csp.split("script-src")[1].split(";")[0]

            print("Application loaded successfully and CSP is strict.")

        except Exception as e:
            print(f"Test failed: {e}")
            raise
        finally:
            browser.close()

if __name__ == "__main__":
    test_csp_verification()
