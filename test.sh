#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== API typecheck (tsc --noEmit) — same check the Docker build runs, incl. test files ==="
# vitest transpiles via esbuild and does NOT type-check; the Docker build runs tsc and
# fails on type errors. Run tsc here so type errors surface in ./test.sh, not as a
# silent image-build failure that leaves the old container running.
(cd "$ROOT/api" && npx tsc --noEmit)

echo ""
echo "=== API unit tests ==="
(cd "$ROOT/api" && npx vitest run)

echo ""
echo "=== Dashboard unit tests ==="
(cd "$ROOT/dashboard" && npx vitest run)

echo ""
echo "All unit tests passed."
