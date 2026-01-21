from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--ignore-certificate-errors"])
        page = browser.new_page(ignore_https_errors=True)
        try:
            page.goto("https://127.0.0.1:3000")
            print(f"Title: {page.title()}")
            page.screenshot(path="verification/homepage.png")
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/homepage_error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
