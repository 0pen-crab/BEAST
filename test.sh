#!/bin/bash
set -e

echo "=== API unit tests ==="
cd api && npx vitest run && cd ..

echo ""
echo "=== Dashboard unit tests ==="
cd dashboard && npx vitest run && cd ..

echo ""
echo "All unit tests passed."
