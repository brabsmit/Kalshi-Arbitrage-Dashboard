
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

// Polyfill window environment for core.js
global.window = {
    crypto: webcrypto,
    atob: atob,
    btoa: btoa
};

// Import the function to test
// Note: We need to import the file directly.
// Since core.js uses 'export', we can import it.
import { signRequest } from '../kalshi-dashboard/src/utils/core.js';

async function testCrypto() {
    console.log("Generating RSA Private Key (PKCS#1)...");
    try {
        execSync('openssl genrsa -out test_key.pem 2048');
    } catch (e) {
        console.error("OpenSSL failed. Is it installed?");
        process.exit(1);
    }

    const privateKeyPem = fs.readFileSync('test_key.pem', 'utf8');
    console.log("Key generated. Testing signRequest...");

    try {
        const timestamp = Date.now();
        const method = "GET";
        const path = "/trade-api/v2/markets";

        const signature = await signRequest(privateKeyPem, method, path, timestamp);

        console.log("Signature generated successfully!");
        console.log("Signature length:", signature.length);
        console.log("Signature (Base64):", signature.substring(0, 50) + "...");

        // Basic validation: signature should be non-empty string
        if (!signature || typeof signature !== 'string' || signature.length < 100) {
            throw new Error("Invalid signature generated");
        }

        // Test PKCS#8 Key (convert existing key)
        console.log("\nConverting to PKCS#8 and testing...");
        execSync('openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in test_key.pem -out test_key_pkcs8.pem');
        const pkcs8Key = fs.readFileSync('test_key_pkcs8.pem', 'utf8');

        const sig8 = await signRequest(pkcs8Key, method, path, timestamp);
        console.log("PKCS#8 Signature generated successfully!");

        // Clean up
        fs.unlinkSync('test_key.pem');
        fs.unlinkSync('test_key_pkcs8.pem');

        console.log("\n✅ VERIFICATION PASSED: Both PKCS#1 and PKCS#8 keys supported via Native Web Crypto.");

    } catch (error) {
        console.error("❌ VERIFICATION FAILED:", error);
        // Clean up
        try { fs.unlinkSync('test_key.pem'); } catch {}
        try { fs.unlinkSync('test_key_pkcs8.pem'); } catch {}
        process.exit(1);
    }
}

testCrypto();
