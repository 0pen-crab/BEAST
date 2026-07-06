# Overnight Work Summary

**Session date:** 2026-05-11 → 2026-05-12

## Status

All 3 planned implementations **shipped**:

| # | Feature | Status |
|---|---------|--------|
| #10 | Export findings per repo | ✅ end-to-end verified (button on repo page, AI-curated CSV download works, filename includes repo slug) |
| #2 Phase 2a | Trail of Bits skills baseline | ⛔ REVERTED 2026-06 — skills were copied to `/root/.claude` but the scanner runs as user `scanner`, so they never loaded. Removed entirely; prompts reverted. ToB value retained via `p/trailofbits` semgrep ruleset only. |
| #4 + #8 | Verify Findings (multi-wave) | ✅ backend + frontend complete |

## Verify Findings — what to test in browser

1. Navigate to any repo with findings (e.g. http://localhost:8000/repos/156)
2. You'll see a prominent **Verify Findings** button between repo name and Scan/Delete
3. Click → modal with: Target URL, severity chips (Critical+High preselected), tool chips (all preselected), context textarea
4. The new **Verification Report** tab on the repo page shows the .md output (empty state until you run one)
5. Scans page shows verification jobs with a "Verification" badge

## What's deferred (NOT done)

- ~~**#2 Phase 2b** (beast-trace step)~~ — dropped along with the ToB skills revert (2026-06).
- **Live verification end-to-end test** — backend pipeline starts correctly and reaches Claude execution, but actual exploit reproduction needs a real target URL. Smoke-tested with example.com; backend correctly fails with "no output from agent" (expected when target is dummy).
- **Pre-existing failures (4 in pipeline.test.ts)** — unrelated to our work, confirmed via clean checkout. Outside the scope of these TODOs.
- **Pending TODOs** — #3 (SSO), #5 (Repo profile layout), #6 (Jira), #7 (Teams/Slack), #9 (Analyzer context bloat) — no plans yet, ready to discuss when you wake up.

## DB migrations applied

- `0004_add_verification.sql` — adds `findings.exploitability_score smallint NULL` and `scans.verification_settings jsonb`

## Tests

- API: full suite pass except 4 pre-existing `pipeline.test.ts` failures (unrelated to our work)
- Dashboard: **673/673 pass**
- 57/57 verification module tests pass
- 8/8 highlights tests pass (including new repo-scoped cases)

## Containers rebuilt

- `api`, `worker`, `dashboard`, `claude-runner` — all rebuilt and restarted
- `worker` now has `PROMPTS_DIR=/prompts` and a read-only mount of `./claude-container/prompts:/prompts:ro` so verification can read prompt templates

## How verification actually flows (end-to-end)

```
User clicks Verify Findings on repo page
  ↓
Modal collects target_url + filters + context_text
  ↓
POST /api/scans { scanType:'verification', verification:{...} }
  ↓
scan row created with scan_type='verification', verification_settings (jsonb)
  ↓
Worker picks it up → dispatches to runVerificationPipeline(scan)
  ↓
Wave 1 (Sonnet) — noise filter + active secret validation
  ↓ writes exploitability_score=0 to refuted findings
Wave 2 (Opus, per CWE category, sequential) — verify each survivor via curl
  ↓ writes exploitability_score 0-100 per attempted finding
Wave 3 (Opus) — chain detective (if ≥2 verified findings)
  ↓
Wave 4 (Opus, per chain) — end-to-end chain confirmation via curl
  ↓
Report builder (Sonnet) — synthesizes .md
  ↓ stored in scan_files with fileType='verification-report'
GET /api/repositories/:id/verification-report → latest .md → Verification Report tab
```

## Known issue (low priority)

If a verification scan FAILS (target unreachable / Claude error), the repo status used to flip to 'failed' too. Fixed in `worker.ts` — verification scans no longer mutate repo status. Old failed scans in DB may have left repos in 'failed' state — clean up with `UPDATE repositories SET status='completed' WHERE status='failed' AND ...` as needed.
