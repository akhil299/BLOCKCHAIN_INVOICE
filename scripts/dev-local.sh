#!/usr/bin/env bash
# Starts a LOCAL Hardhat chain (free, instant, no faucet) and deploys InvoChain to it.
# Leave this running, then start the backend and frontend in two more terminals (see README).
set -euo pipefail
cd "$(dirname "$0")/../contracts"
[ -d node_modules ] || npm install --legacy-peer-deps
export USE_SOLCJS=${USE_SOLCJS:-0}
npx hardhat node > /tmp/invochain-node.log 2>&1 &
NODE_PID=$!
trap 'kill $NODE_PID 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -m 2 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","method":"eth_chainId","id":1}' http://127.0.0.1:8545 >/dev/null && break; sleep 1; done
npx hardhat run scripts/deploy.js --network localhost
echo
echo "Local chain running (Ctrl+C to stop). Account keys: see /tmp/invochain-node.log"
echo "Use Account #0's key as OPERATOR_PRIVATE_KEY and its address as ADMIN_WALLETS in .env"
wait $NODE_PID
