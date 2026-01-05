
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    args: ['--ignore-certificate-errors']
  });
  const page = await browser.newPage();

  // Try connecting to local server
  try {
    console.log("Navigating to https://localhost:3000...");
    await page.goto('https://localhost:3000', { waitUntil: 'networkidle' });
    console.log("Page loaded.");

    // Check if App is rendered
    const title = await page.title();
    console.log("Title:", title);

    // Check EventLog presence
    const eventLog = await page.$('text=Event Log');
    if (eventLog) console.log("✅ EventLog found");
    else console.error("❌ EventLog NOT found");

    // Check LatencyDisplay (look for 'ago' text)
    // We wait a bit to ensure ticking
    await page.waitForTimeout(2000);
    const agoText = await page.textContent('body');
    if (agoText.includes('ago')) console.log("✅ LatencyDisplay (ago) found");
    else console.error("❌ LatencyDisplay NOT found");

    // Take screenshot
    await page.screenshot({ path: 'verification/perf_verify.png' });

  } catch (e) {
    console.error("Error:", e);
  } finally {
    await browser.close();
  }
})();
