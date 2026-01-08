
const runBenchmark = () => {
  const SIZE = 2000;
  const positions = [];

  // Create duplicates
  for (let i = 0; i < SIZE; i++) {
    const id = `pos-${i % (SIZE / 2)}`; // 50% duplicates
    positions.push({
      id: id,
      isOrder: false,
      settlementStatus: 'settled',
      quantity: 10
    });
  }

  console.log(`Benchmarking filter with ${SIZE} items...`);

  // 1. Current O(N^2) Implementation
  const startOriginal = performance.now();
  const originalResult = positions.filter((p, index, self) => {
     if (!p.isOrder) {
         const firstIdx = self.findIndex(x => !x.isOrder && x.id === p.id && x.settlementStatus === p.settlementStatus);
         if (firstIdx !== index) return false;
     }
     return true;
  });
  const endOriginal = performance.now();
  console.log(`Original O(N^2) Time: ${(endOriginal - startOriginal).toFixed(3)} ms`);

  // 2. Optimized O(N) Implementation
  const startOptimized = performance.now();
  const seen = new Set();
  const optimizedResult = positions.filter(p => {
    if (!p.isOrder) {
      const key = `${p.id}-${p.settlementStatus}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  });
  const endOptimized = performance.now();
  console.log(`Optimized O(N) Time: ${(endOptimized - startOptimized).toFixed(3)} ms`);

  // Verify results match
  if (originalResult.length !== optimizedResult.length) {
    console.error(`Mismatch! Original: ${originalResult.length}, Optimized: ${optimizedResult.length}`);
  } else {
    console.log("Results match!");
  }
};

runBenchmark();
