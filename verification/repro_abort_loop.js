
const STALE_DATA_THRESHOLD = 2000; // Reduced for test
const INTERVAL = 1000;

let lastFetchTime = Date.now();
let abortController = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchLiveOdds() {
    console.log(`[${Date.now()}] Fetch triggered`);

    if (abortController) {
        console.log("Aborting previous request");
        abortController.abort();
    }
    abortController = new AbortController();
    const signal = abortController.signal;

    try {
        // Simulate network request that takes longer than INTERVAL
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                resolve("Success");
            }, 1500); // Takes 1.5s, but Interval is 1s

            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error("AbortError"));
            });
        });

        console.log("Fetch Success!");
        lastFetchTime = Date.now();
    } catch (e) {
        console.log(`Fetch Failed: ${e.message}`);
    }
}

async function run() {
    console.log("Starting Loop...");

    // Simulate setInterval
    const interval = setInterval(() => {
        fetchLiveOdds();
    }, INTERVAL);

    // Initial call
    fetchLiveOdds();

    // Monitor Stale State
    const monitor = setInterval(() => {
        const diff = Date.now() - lastFetchTime;
        console.log(`Time since last success: ${diff}ms`);
        if (diff > STALE_DATA_THRESHOLD) {
            console.log("!!! DATA IS STALE - BOT WOULD GO IDLE !!!");
        }
    }, 500);

    // Run for 10 seconds
    await sleep(10000);
    clearInterval(interval);
    clearInterval(monitor);
}

run();
