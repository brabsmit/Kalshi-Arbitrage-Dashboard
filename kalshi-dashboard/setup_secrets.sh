#!/bin/bash

# Helper script to setup secrets for Live Testing

SECRETS_DIR=".secrets"

if [ ! -d "$SECRETS_DIR" ]; then
    mkdir -p "$SECRETS_DIR"
    echo "Created $SECRETS_DIR directory."
fi

echo "Please enter your Kalshi Demo API Key ID:"
read -r key_id
echo "$key_id" > "$SECRETS_DIR/demo_key_id"

echo "Please paste your Private Key content (including BEGIN/END headers), then press Ctrl+D:"
cat > "$SECRETS_DIR/demo_private.key"

echo "Secrets saved to $SECRETS_DIR/"
echo "You can now run live tests with: TEST_LIVE=1 pytest tests/test_live.py"
