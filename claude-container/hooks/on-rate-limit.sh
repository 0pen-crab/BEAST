#!/bin/bash
# Claude Code hook: fires on StopFailure with rate_limit matcher.
# Notifies BEAST API to pause the scan queue.

INPUT=$(cat)

# Extract resetsAt unix timestamp from transcript (rate_limit_event has it)
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null)
RESETS_AT=""
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  RESETS_EPOCH=$(grep -o '"resetsAt":[0-9]*' "$TRANSCRIPT" | tail -1 | grep -o '[0-9]*')
  if [ -n "$RESETS_EPOCH" ]; then
    RESETS_AT=$(date -u -d "@$RESETS_EPOCH" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")
  fi
fi

curl -sS -X POST http://api:3000/api/worker/pause \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: ${INTERNAL_TOKEN:-}" \
  -d "{\"reason\":\"rate_limit\",\"resumesAt\":\"$RESETS_AT\"}" \
  > /dev/null 2>&1

exit 0
