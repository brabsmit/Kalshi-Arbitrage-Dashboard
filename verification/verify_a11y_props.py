from playwright.sync_api import sync_playwright

def test_accessibility_props():
    # Since we can't easily hydrate the React app without a server in this verification script,
    # we will rely on static inspection of the source files which we already did,
    # OR we can try to verify the bundled JS output if we were desperate.
    # But actually, we can try to "render" by just using regex on the source file to ensure the props exist.
    # This is less robust than a live test but sufficient for "verifying code presence".

    with open('kalshi-dashboard/src/App.jsx', 'r') as f:
        content = f.read()

    # Check CancellationModal progress bar
    assert 'role="progressbar"' in content, "CancellationModal missing role='progressbar'"
    assert 'aria-valuenow={percentage}' in content, "CancellationModal missing aria-valuenow"
    assert 'aria-label="Cancellation Progress"' in content, "CancellationModal missing aria-label"

    # Check MarketRow spinner
    assert '<span className="sr-only">Placing Bid...</span>' in content, "MarketRow missing sr-only loading text"
    assert 'aria-hidden="true"' in content, "Loader2 missing aria-hidden='true'"

    # Check PortfolioRow cancel button
    assert 'aria-label={`Cancel Order for ${item.marketId}`}' in content, "PortfolioRow missing dynamic aria-label"

    print("✅ All accessibility props verified in source code.")

if __name__ == "__main__":
    test_accessibility_props()
