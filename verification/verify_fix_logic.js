
const STALE_DATA_THRESHOLD = 2000;
const INTERVAL = 1000;

let lastFetchTime = Date.now();
let isLoading = false; // The fix
let abortController = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchLiveOdds(force = false) {
    console.log(`[${Date.now()}] Fetch triggered (force=${force})`);

    // THE FIX: Check isLoading
    if (!force && isLoading) {
        console.log("Skipping request: already loading");
        return;
    }

    if (abortController) {
        // We only abort if force is true, or if we weren't skipping (but we returned above)
        // In the fixed code:
        // if (abortControllerRef.current) abortControllerRef.current.abort();
        // abortControllerRef.current = new AbortController();

        // Wait, in the actual fix in App.jsx:
        /*
          // Prevent overlapping requests that cause abort loops
          if (!force && isLoadingRef.current) return;
          if (!force && (now - lastFetchTimeRef.current < cooldown)) return;

          if (abortControllerRef.current) abortControllerRef.current.abort();
          abortControllerRef.current = new AbortController();
        */
        // So we abort ONLY if we proceed.
        console.log("Aborting previous request (if any active)");
        abortController.abort();
    }

    abortController = new AbortController();
    const signal = abortController.signal;

    try {
        isLoading = true; // Set lock

        // Simulate network request that takes longer than INTERVAL
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                resolve("Success");
            }, 1500); // Takes 1.5s

            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error("AbortError"));
            });
        });

        console.log("Fetch Success!");
        lastFetchTime = Date.now();
    } catch (e) {
        console.log(`Fetch Failed: ${e.message}`);
    } finally {
        isLoading = false; // Release lock
    }
}

async function run() {
    console.log("Starting Fixed Loop...");

    const interval = setInterval(() => {
        fetchLiveOdds(false);
    }, INTERVAL);

    // Initial call
    fetchLiveOdds(true);

    // Monitor Stale State
    const monitor = setInterval(() => {
        const diff = Date.now() - lastFetchTime;
        console.log(`Time since last success: ${diff}ms`);
        if (diff > STALE_DATA_THRESHOLD) {
            console.log("!!! DATA IS STALE - FIX FAILED !!!");
        }
    }, 500);

    // Run for 10 seconds
    await sleep(10000);
    clearInterval(interval);
    clearInterval(monitor);
}

run();
