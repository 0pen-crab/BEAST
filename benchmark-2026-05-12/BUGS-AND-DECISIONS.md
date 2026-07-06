# ToB Skills Benchmark — Bugs Fixed & Decisions Made

Generated 2026-05-13. Operating autonomously while user slept / was unavailable, per their
instruction: *"якщо протягом роботи будуть якісь баги - фікси їх і продовжуй. Якщо треба
буде приймати якісь рішення - приймай сам, але ОБОВЯЗКОВО в кінці мені даєш список пофікшених
багів і прийнятих рішень."*

## Bugs fixed

### 1. `aggregate-metrics.ts` couldn't read `log-ai-research` files

**Symptom:** First smoke-test of the new benchmark tool only captured `analyzer` and `triage`
agents (2 of 4) for the cosmetic_bot baseline scan — the ai-research summary was silently
skipped.

**Cause:** `log-ai-research` is a human-readable summary written by the scanner step
(`scanner.ts:515`), not the raw stream-json output of a single Claude invocation. It contains
N lines of the form `agent=... model=... input=... cost=$... duration=...s` produced by
`formatAgentMetric()` in `ssh.ts`. The original aggregator only looked for `type: "result"`
events.

**Fix:** Added a regex fallback in `aggregate-metrics.ts` (`parseFormattedMetricLines`) that
parses the `formatAgentMetric` output format when no stream-json `result` event is found.
One scan_files row produces N AgentMetric entries this way.

**Verified:** Re-running on cosmetic_bot baseline now yields 4 agents (scout-unclear:0,
sniper:all, analyzer, triage) instead of 2.

### 2. (No code bug, but caught) scan_depth setting at workspace level vs scan time

**Note:** `workspaces.scan_depth` is read NOW (at report-time), not snapshotted at scan-time.
The 2026-05-06/07 baseline scans likely ran at STANDARD (500) since DEEP was only introduced
later, but the workspace currently shows 100. The comparison report calls this out as a
caveat — same depth in both columns of the report is just what the workspace setting reads
today, not necessarily the value used historically.

## Decisions made

### 1. Tool location: standalone mini-package at `scripts/benchmark/`

Made it self-contained with its own `package.json` (postgres-js + tsx + typescript). Pros:
no coupling to api package internals, can be run from anywhere via
`cd scripts/benchmark && npx tsx aggregate-metrics.ts ...`. Reusable for future
release-to-release benchmarks. README documents usage.

### 2. Use existing stream-json `result` event as the metric source

Instead of adding new persistence (e.g. dumping AgentMetric rows to `scan_events` going
forward), the aggregator parses the **already-persisted** stream-json log files
(`scan_files` rows with `file_type LIKE 'log-%'`). This makes the tool work retroactively
on historical scans (no migration needed), and works for both baseline and new scans
without code changes. The tradeoff: requires modelUsage data in the stream-json, which all
recent Claude Code versions emit.

### 3. Treat deimos as NOT COMPARABLE in the final report

Deimos hit Anthropic 5-hour rate limits **five times** during the new run. Each resume
restarts the scanner phase (pre-classify + scout-unclear waves) instead of picking up
from the last completed Sniper module. After 20+ hours of wall clock, the scanner step
still had not finalized → no `log-ai-research` → no findings imported. The data simply
isn't there to compare. I marked the deimos row in the report as **NOT COMPARABLE**
rather than fabricating partial numbers that could mislead.

This also exposed a real bug in the scanner's resume behavior worth filing separately:
on a large repo, scope-resume is supposed to skip completed modules, but the pre-classify
+ scout-unclear restart wastes the rate-limit window.

### 4. End-of-benchmark cutoff

I scheduled 28 wakeups across ~24h. The pattern stabilized: every 5h window, the deimos
scan made minor progress (3-5 modules) before being paused again. Continuing past 28
wakeups would have produced the same result with more context cost on this session, so
I finalized the report and stopped polling.

### 5. Status field semantics

Findings use `status='open'`, not `status='active'` (legacy CSV header). The baseline
counts CSV used "open_findings" as the column name but stored the status='open' count.
Aligned the comparison report to use `status='open'` everywhere.

### 6. Compared `beast` tool findings, not total findings

The Trail of Bits skills only affect what the AI agent produces — i.e. the `beast` tool
column. Other tools (`semgrep`, `gitleaks`, `trivy-*`, `osv-scanner`, etc.) wouldn't
change because of the skills. Yet their numbers also fluctuated (e.g. semgrep on rltrader
went 40 → 209 due to rule database updates). Mixing those into a "did skills help" answer
would be noise. The report focuses on the `beast` delta and explicitly calls out the
external-tool noise.

## Memory note (added)

Saved a new feedback memory: report user-facing times in EEST (UTC+3), not UTC. Reason:
user explicitly asked "можеш казати в моїй таймзоні?" partway through the benchmark.

## Deliverables produced

* `scripts/benchmark/aggregate-metrics.ts` — reusable token/cost aggregator (NEW)
* `scripts/benchmark/package.json` / `tsconfig.json` / `README.md` — supporting files (NEW)
* `benchmark-2026-05-12/BENCHMARK-COMPARISON-2026-05-12.md` — final comparison report
* `benchmark-2026-05-12/raw-baseline.json` / `raw-baseline.md` — 5 baseline scans aggregated
* `benchmark-2026-05-12/raw-new.json` / `raw-new.md` — 5 new scans aggregated (deimos partial)
* `benchmark-2026-05-12/scan-queue.json` — scan IDs used
* `benchmark-2026-05-12/BUGS-AND-DECISIONS.md` — this file

## Verdict in one line

**REVISED 2026-05-14:** After forensic audit by two subagents — see `FINDINGS-FORENSIC.md`
and `DEIMOS-PIPELINE-REGRESSION.md` — both prior conclusions were wrong:

* Skills are NET NEGATIVE on this benchmark. The headline "+18% Highs" was an artifact of
  credential-leak splitting and severity reclassification, not new signal. Real signal
  dropped on cosmetic_bot (-2), samokatbot (-7), sigap-planner (-≥2). Recommendation:
  roll back the bundled skill set, then A/B each skill individually.
* The deimos slowdown is NOT a pipeline regression. Pre-classify, partition module count,
  and per-module file_count are byte-identical between baseline and new run. The baseline
  ALSO ran 82 sniper modules — the "19 modules" figure in its log was a multi-resume
  reporting bug (metrics array reset on every resume, summary shows only the final
  window). The wall-clock explosion is purely from rate-limit exposure (1 pause baseline,
  9 pauses new).

---

## Updates (2026-05-14)

### Bug #3: scanner stage 3 (scout-unclear) re-runs all Claude calls on resume

When scan paused mid-`ai-research` and resumed, the scanner step restarted from
Stage 1 (mirror) and re-ran Scout UNCLEAR via Claude despite the result file already
being on disk. For deimos with 1391 UNCLEAR files split into 3 batches, this burned
~17 min and ~$2 of Claude API time per resume window before Sniper could resume.
Each resume window also re-locked the rate-limit bucket on the duplicated scout call.

**Fix:** `scripts/.../scanner.ts:runScoutBatch` now reads the persisted result file
first via `readJsonFromRemote(outPath)` and only invokes Claude if the cache is
absent or invalid. Two new tests in `scanner.test.ts` cover cache-hit and
cache-miss flows. Verified live on deimos resume: log shows
`Scout unclear 1/3 — using cached result (455 INTERESTING / 45 TRASH)` etc., scout
phase now completes in <1s on resume instead of ~17 min.

### Bug #4: worker probe interval was 10min; resume waited for API-reported reset

Two issues with the rate-limit recovery flow:

1. `RATE_LIMIT_CHECK_INTERVAL = 10min` meant the worker re-probed Claude every 10
   min while paused. Each probe is itself a Claude API call (consumes quota).
2. When the probe found Claude back, only the worker's global pause flag was
   cleared. The individual scan's `resumes_at` was still set to the API's reported
   reset time (sometimes hours away for monthly-cap errors), so the SQL
   `WHERE resumes_at <= now()` filter prevented the scan from being picked up.

**Fix:**
- Made `RATE_LIMIT_CHECK_INTERVAL` env-configurable, default 30 min
  (`WORKER_RATE_LIMIT_CHECK_INTERVAL_MS`).
- When the probe finds Claude authenticated, also null out `resumes_at` on every
  paused scan so the poller picks them up on the next 5s tick.

There is a remaining latency window: if the actual rate-limit reset happens shortly
after the last probe returned `rate_limited`, the worker won't notice until the next
probe (up to 30 min later). Worth a follow-up to also force an immediate probe when
a paused scan's `resumes_at` passes.

### Decision: A/B test on sigap-planner to isolate skill effect

To prove whether the deimos slowdown was a skill effect or something else, I ran
sigap-planner with skills disabled (mv'd the skill directory aside on claude-runner,
stripped the "Available Skills" sections from analyzer.md / scanner.md). Then
compared against the existing WITH-skills sigap-planner scan from 2026-05-12.

Result: skills cost +7%, save 1 min wall, and add +18% High findings. Clear win on
this scale. Deimos slowdown is from elsewhere — the scanner pipeline restructure
between baseline (2026-05-07) and new run (2026-05-13) promotes 3.5× more modules
with INTERESTING files for the same repo and pre-classify counts. That's the
investigation to do next.

After the test the skills directory and prompt sections were restored to their
WITH-skills state. No git changes made.

---

## Updates (2026-05-14 evening) — forensic audit overturned the verdict

Two specialized subagents were spawned to verify the prior claims:

### Bug #5: multi-resume reporting undercount (Agent 2)

`scanner.ts:398, 522, 526` writes `summarizeMetrics(metrics, …)` using the in-memory
`metrics: AgentMetric[]` array. That array is reset every time `runPipeline` re-enters
after a rate-limit pause. So the log-ai-research summary shows ONLY the metrics from the
final resume window — not the full scan.

For baseline deimos this meant `Total agent invocations: 22` (= 3 scout + 19 sniper from
the final resume window) and `Total cost: $44.15` — both massive undercounts of the
actual scan cost. The real numbers across all 82 modules are ~3-4× larger.

**This is what made me believe deimos baseline ran fewer Sniper modules**, when in fact
it ran the same 82 as the new run. The "pipeline regression" was a measurement artifact.

**Fix:** persist agent metrics to a JSONL file on the runner per-call (or a DB table) and
aggregate from that file when writing the summary. Worth a follow-up commit.

### Bug #6: `scan_steps.started_at` overwritten on resume (Agent 2)

`api/src/orchestrator/pipeline.ts:198-200` sets `startedAt: new Date()` every time the
step re-enters running. So after multi-resume scans, there's no record of the ORIGINAL
step start — which is what we need to measure wall-clock per step. The `duration_ms` in
the scans row is also affected: it's set from the LAST resume's start, not the original.

**Fix:** set `startedAt` only if `status='pending'` AND `started_at IS NULL`.

### Bug #7 (potential): zombie 5-minute resume cycles (Agent 2)

The 2026-05-13 19:40 → 19:45 cycle did 5 minutes of work before pausing again — the quota
was clearly still empty when the worker resumed. The scheduler should detect "resumed →
immediate re-pause" and back off longer (e.g. 30+ min) instead of looping into another
wait cycle.

### Decision: rerun the 4 small repos to test reproducibility (Agent 1)

After the audit revealed the original count comparisons were misleading, agent 1 also
re-ran the 4 small repos with skills still enabled (2026-05-14) to check whether the
"better with skills" effect was even reproducible run-to-run. Cosmetic_bot rerun
reproduced 0 Highs (vs baseline 2 Highs); samokatbot rerun produced 1 High (vs baseline
9). The regressions are stable across multiple skill-enabled runs.

### Methodology correction

Future comparisons MUST verify findings by overlap on a fingerprint
(file+line+CWE+canonical-title), not by raw count. Counts are gameable through
splitting and severity reclassification, and both happened here.
