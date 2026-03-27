#!/bin/bash
set -e

echo "=== Hermes Compatibility Check ==="
node scripts/check-hermes-compat.js || exit 1

echo ""
echo "=== TypeScript Check ==="
npx tsc --noEmit || exit 1

echo ""
echo "=== API Integration Tests ==="
node scripts/test-api.js || exit 1

echo ""
echo "=== All checks passed! ==="
