#!/bin/bash
# Claude Code hook: fires on StopFailure with rate_limit matcher.
# Notifies BEAST API to pause the scan queue.

INPUT=$(cat)
ERROR_MSG=$(echo "$INPUT" | jq -r '.error_message // "Rate limit exceeded"' 2>/dev/null)

# BEAST API is reachable at http://api:3000 from within Docker network
curl -sS -X POST http://api:3000/api/worker/pause \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: ${INTERNAL_TOKEN:-}" \
  -d "{\"reason\":\"rate_limit\",\"message\":\"$ERROR_MSG\"}" \
  > /dev/null 2>&1

exit 0
