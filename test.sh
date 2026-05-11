#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== API unit tests ==="
(cd "$ROOT/api" && npx vitest run)

echo ""
echo "=== Dashboard unit tests ==="
(cd "$ROOT/dashboard" && npx vitest run)

echo ""
echo "All unit tests passed."
