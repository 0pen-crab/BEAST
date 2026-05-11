#!/usr/bin/env bash
set -euo pipefail

# BEAST Pre-Release Test Suite
# Runs all E2E tests with clear reporting.
# Usage: ./pre-release.sh [--headed] [--grep <pattern>]

HEADED=""
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --headed)
      HEADED="--headed"
      shift
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

BOLD="\033[1m"
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║   BEAST Pre-Release Test Suite       ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${RESET}"
echo -e "  Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Check app is running
echo -e "${BOLD}Checking app is running at localhost:8000...${RESET}"
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:8000 | grep -q "200\|302\|301"; then
  echo -e "${RED}ERROR: App is not running at localhost:8000${RESET}"
  echo "  Run: docker compose up -d"
  exit 1
fi
echo -e "${GREEN}  App is up${RESET}"
echo ""

# Test groups in execution order
declare -a SPECS=(
  "smoke.spec.ts"
  "auth.spec.ts"
  "navigation.spec.ts"
  "dashboard.spec.ts"
  "scans.spec.ts"
  "repos.spec.ts"
  "repo-detail.spec.ts"
  "findings.spec.ts"
  "events.spec.ts"
  "teams.spec.ts"
  "developers.spec.ts"
  "members.spec.ts"
  "settings.spec.ts"
  "onboarding.spec.ts"
  "i18n.spec.ts"
)

PASSED=0
FAILED=0
SKIPPED=0
FAILURES=()
START_TIME=$(date +%s)

for spec in "${SPECS[@]}"; do
  echo -e "${BOLD}Running: ${spec}${RESET}"

  # Force single worker — some specs share workspace state and flake under parallelism
  if npx playwright test "e2e/${spec}" --workers=1 $HEADED "${EXTRA_ARGS[@]}" 2>&1 | tail -5; then
    echo -e "  ${GREEN}PASS${RESET}"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${RESET}"
    ((FAILED++))
    FAILURES+=("$spec")
  fi
  echo ""
done

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
TOTAL=$((PASSED + FAILED))

# Summary
echo -e "${BOLD}${CYAN}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║   Pre-Release Results                ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${RESET}"
echo -e "  Total specs:  ${TOTAL}"
echo -e "  ${GREEN}Passed:       ${PASSED}${RESET}"
echo -e "  ${RED}Failed:       ${FAILED}${RESET}"
echo -e "  Duration:     ${DURATION}s"
echo ""

if [ ${FAILED} -gt 0 ]; then
  echo -e "${RED}${BOLD}  FAILED SPECS:${RESET}"
  for f in "${FAILURES[@]}"; do
    echo -e "  ${RED}  - ${f}${RESET}"
  done
  echo ""
  echo -e "${RED}${BOLD}  PRE-RELEASE: BLOCKED${RESET}"
  echo ""
  echo "  Run individual spec for details:"
  echo "    npx playwright test e2e/<spec> --headed"
  exit 1
else
  echo -e "${GREEN}${BOLD}  PRE-RELEASE: READY TO SHIP${RESET}"
  exit 0
fi
