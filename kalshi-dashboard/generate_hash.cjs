const crypto = require('crypto');

const password = process.argv[2];

if (!password) {
    console.error('Usage: node generate_hash.js <password>');
    process.exit(1);
}

const hash = crypto.createHash('sha256').update(password).digest('hex');
console.log(`Password: ${password}`);
console.log(`Hash (SHA-256): ${hash}`);
console.log('\nAdd this to your .env file:');
console.log(`VITE_APP_PASSWORD_HASH=${hash}`);
