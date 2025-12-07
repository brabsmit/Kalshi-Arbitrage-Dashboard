
const americanToProbability = (odds) => {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
};

function processOdds(game, targetOutcomeName) {
    const bookmakers = game.bookmakers || [];
    if (bookmakers.length === 0) return null;

    const validBookmakers = [];
    const vigFreeProbs = [];

    for (const bm of bookmakers) {
        const outcomes = bm.markets?.[0]?.outcomes;
        if (!outcomes || outcomes.length < 2) continue;

        const targetOutcome = outcomes.find(o => o.name === targetOutcomeName);
        if (!targetOutcome) continue;

        let totalImpliedProb = 0;
        const outcomeProbs = outcomes.map(o => {
            const p = americanToProbability(o.price);
            totalImpliedProb += p;
            return { name: o.name, price: o.price, implied: p };
        });

        const targetData = outcomeProbs.find(o => o.name === targetOutcomeName);
        const vigFreeProb = targetData.implied / totalImpliedProb;

        validBookmakers.push({
            key: bm.key,
            vigFreeProb: vigFreeProb,
            price: targetOutcome.price
        });
        vigFreeProbs.push(vigFreeProb);
    }

    if (vigFreeProbs.length === 0) return null;

    const minProb = Math.min(...vigFreeProbs);
    const maxProb = Math.max(...vigFreeProbs);
    const avgProb = vigFreeProbs.reduce((a, b) => a + b, 0) / vigFreeProbs.length;

    // Safeguard: Reject if max - min > 0.15
    const spread = maxProb - minProb;
    if (spread > 0.15) {
        return { error: `Spread too high: ${(spread * 100).toFixed(2)}%` };
    }

    return {
        avgVigFreeProb: avgProb,
        bookmakerCount: vigFreeProbs.length,
        minProb,
        maxProb,
        spread
    };
}

// Test Cases
const testCases = [
    {
        name: "Consistent Odds",
        game: {
            bookmakers: [
                { key: "bk1", markets: [{ outcomes: [{ name: "A", price: -110 }, { name: "B", price: -110 }] }] }, // 50%
                { key: "bk2", markets: [{ outcomes: [{ name: "A", price: -105 }, { name: "B", price: -115 }] }] }, // ~50%
            ]
        },
        target: "A",
        expected: "Success"
    },
    {
        name: "High Discrepancy (Reject)",
        game: {
            bookmakers: [
                { key: "bk1", markets: [{ outcomes: [{ name: "A", price: 100 }, { name: "B", price: -120 }] }] }, // ~47% vig free
                { key: "bk2", markets: [{ outcomes: [{ name: "A", price: -200 }, { name: "B", price: 150 }] }] }, // ~64% vig free
            ]
        },
        target: "A",
        expected: "Reject"
    }
];

testCases.forEach(tc => {
    console.log(`Running Test: ${tc.name}`);
    const result = processOdds(tc.game, tc.target);
    console.log(JSON.stringify(result, null, 2));
    if (tc.expected === "Reject" && result.error) console.log("PASS: Rejected correctly");
    else if (tc.expected === "Success" && !result.error) console.log("PASS: Accepted correctly");
    else console.log("FAIL");
    console.log("-".repeat(20));
});
