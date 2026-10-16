# Benchmark Handoff: ToB Skills Effectiveness

**Goal:** prove (or disprove) that adding Trail of Bits skills to claude-runner improved scan quality.
**Compared against:** historical scans of the same 5 repos before ToB skills were baked in.
**Status:** queued for execution, awaiting your decision on whether to run.

---

## TL;DR for the next session

Read the benchmark README for the repo list. Run 5 scans (skip `phobos` — too large for overnight). Configuration is **DEEP** (scan_depth=100), Sonnet/Opus/Opus, AI on. Track per-agent token usage / cost via existing `buildAgentMetric`. Compare delta vs baseline saved here, write report to `REPORT.md`.

**ToB skills are already baked into `claude-runner` image.** See `claude-container/skills/trailofbits/` and `MEMORY.md` `project_trailofbits_skills.md`.

---

## Configuration (CONFIRMED by user)

- **Repos (5, exclude phobos):**
  - `cosmetic_bot` (id 151)
  - `samokatbot` (id 152)
  - `rltrader` (id 153)
  - `sigap-planner` (id 154)
  - `deimos` (id 156)
- **scan_depth = 100 (DEEP / BEAST MODE)** — maximum coverage, set on workspace 16 (`bebench`)
- **AI all on**, models: `analyzer=sonnet, scanner=opus, triage=opus` (default of workspace 16)
- **scan_type = 'full'** (not verification)
- **Workspace 16** (`bebench`) is the benchmark workspace

---

## What's already done

1. ✅ Baseline counts snapshotted → `data/baseline-counts.csv` (open findings per severity per repo)
2. ✅ Workspace `bebench` is set to `scan_depth=100` (verified — see DB)
3. ✅ ToB skills are baked into claude-runner (rebuilt and live)

---

## What needs to happen

### Step 1 — Build reusable token-cost tracker tool

The user wants a **reusable tool** for tracking tokens + cost per benchmark, **not** ad-hoc log grepping. Reuse existing primitives:

- `api/src/orchestrator/pipeline-types.ts` already defines `AiUsage` (inputTokens, cacheReadInputTokens, cacheCreationInputTokens, outputTokens, costUSD, model).
- `api/src/orchestrator/ssh.ts` exports `buildAgentMetric()` which builds `AgentMetric` per Claude invocation.
- These metrics are logged via `logAgentMetric()` — find where they go (likely `scan_events` table or stdout that gets parsed).

**Tool to build:** `benchmarks/tools/-report.ts` (or `.js`) that:
1. Takes a list of scan IDs (or repo names + date range) as input
2. Queries `scan_events` / `scan_modules` / wherever AiUsage metrics persist
3. Aggregates per scan: total input tokens, total output tokens, total cache tokens, total cost USD, total duration
4. Aggregates per agent (analyzer / scanner / triage / others): token breakdown + cost
5. Emits both **JSON** (for diffing) and **human-readable markdown** report

**Location:** `benchmarks/tools/` directory, with proper TS types.

### Step 2 — Run the 5 scans

Use the API directly via authenticated browser session OR `curl`. Queue order: small to large.

```javascript
// Run in browser console authenticated as admin:
const token = localStorage.getItem('beast_token');
const order = [
  { id: 151, name: 'cosmetic_bot' },
  { id: 152, name: 'samokatbot' },
  { id: 153, name: 'rltrader' },
  { id: 154, name: 'sigap-planner' },
  { id: 156, name: 'deimos' },
];
for (const r of order) {
  await fetch('/api/scans', {
    method: 'POST',
    headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositoryId: r.id, scanType: 'full' }),
  });
}
```

Save the resulting scan IDs to `data/scan-queue.json` (overwrite the stale one already there with wrong config).

**Worker runs sequentially.** Expected total time at DEEP=100:
- cosmetic_bot (7 files): ~5 min
- samokatbot (51 files): ~8 min
- rltrader (187 files): ~25 min
- sigap-planner (617 files): ~50 min (single Sniper module since ≤2000 threshold)
- deimos (8280 files): 8280/100 ≈ 83 modules × 4 min = ~5.5 hours

**Total estimate: 6.5–7 hours.** Phobos was excluded specifically because at DEEP it would be 18+ hours.

### Step 3 — Poll progress every 30 min

Use `ScheduleWakeup` with `delaySeconds: 1800`. Each wake-up:
1. Query DB: `SELECT id, repo_name, status, duration_ms/60000 AS min FROM scans WHERE id IN (...)`
2. If all 5 are `status='completed'` → proceed to Step 4
3. If any `status='failed'` or `status='paused'` → diagnose (rate limit pause is OK, fails are not)
4. Otherwise → another wake-up

### Step 4 — Generate comparison report

Output: `benchmark-2026-05-12/REPORT.md`

For each of 5 repos, side-by-side:

| Metric | Before (baseline) | After (with ToB skills) | Δ |
|---|---|---|---|
| Total findings | X | Y | +Z (%) |
| Critical | ... | ... | ... |
| High | ... | ... | ... |
| Medium | ... | ... | ... |
| Low | ... | ... | ... |
| Info | ... | ... | ... |
| Duration (min) | ... | ... | ... |
| Total cost (USD) | ... | ... | ... |
| Input tokens | ... | ... | ... |
| Output tokens | ... | ... | ... |
| Cache hit ratio | ... | ... | ... |
| Distinct CWEs | ... | ... | ... |
| Distinct tools that found something | ... | ... | ... |

**Plus interpretation section:**
- Did findings increase / decrease overall?
- Are the new findings higher-quality (more Critical/High vs Info)?
- Did cost go up disproportionately to findings gained?
- Did duration increase due to extra skill invocations?

**Baseline data location:**
- `data/baseline-counts.csv` — current open findings counts per repo per severity (snapshot before re-run)
- `scan_events` table in DB has historic per-agent metrics for the 2026-05-06 / 2026-05-07 baseline scans (look up scan IDs from `scans` table where `repository_id IN (...)` and `created_at < '2026-05-10'`)

---

## Files in this directory

- `PROTOCOL.md` — this file
- `data/baseline-counts.csv` — open findings snapshot (already saved)
- `data/scan-queue.json` — IGNORE this (old, wrong config). Overwrite when Step 2 runs.

## Files to create

- `benchmarks/tools/aggregate-metrics.ts` — the reusable tool
- `benchmark-2026-05-12/data/scan-queue.json` — fresh list of scan IDs
- `benchmark-2026-05-12/raw-metrics.json` — aggregated metrics output
- `benchmark-2026-05-12/REPORT.md` — the final report

---

## Critical reminders

1. **DEEP scan_depth=100 is non-negotiable** per user instruction. Don't switch to STANDARD even if it would be faster.
2. **Don't include phobos.** Too large for overnight.
3. **The token-cost tool must be reusable.** Don't hardcode for this one benchmark.
4. **Don't touch git.** Working with files only.
5. **Worker is sequential.** Queue all 5 at once — they'll process one by one.
6. **Rate limit pauses are normal.** Sniper modules have resume logic. Don't panic if a scan goes 'paused' temporarily.
7. **Container ToB skills baked in `/root/.claude/skills/trailofbits/`** — verify via `docker compose exec claude-runner ls /root/.claude/skills/trailofbits/` if questioning.

---

## Where ToB skills live and how they're invoked

- Source: `claude-container/skills/trailofbits/`
- 6 skills loaded: `entry-point-analyzer`, `audit-context-building`, `insecure-defaults`, `sharp-edges`, `static-analysis`, `supply-chain-risk-auditor`
- Mentioned in prompts: `claude-container/prompts/analyzer.md` (3 skills) + `claude-container/prompts/scanner.md` (3 skills)
- Claude Code auto-discovers them via the standard skills mechanism

---

## Open question for user (FYI, don't block)

- The 2026-05-06 baseline scans were almost certainly **STANDARD** (scan_depth=500), not DEEP. That's an apples-to-oranges comparison at the cost level (DEEP is roughly 5× more expensive per scan). I'll note this caveat in the final report. If user wants true apples-to-apples, they'd need to re-run the *baseline* at DEEP too — but that's not in scope.

---

## Memory note worth saving

After the report is done, add to MEMORY.md:
> Benchmark methodology: 5 repos from ../README.md (exclude phobos), DEEP depth, scripts in `benchmarks/tools/` are reusable for release-to-release comparisons.
