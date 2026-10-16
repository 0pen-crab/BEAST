# Deimos pipeline regression — root cause analysis

**Scans investigated**
- Baseline: `0f420879-4a6a-4d85-bb3d-e07a60638322` (started 2026-05-07 16:41 UTC, completed 2026-05-08 02:29 UTC)
- New:      `c8ab5d3b-5ac6-4eb7-bddf-ee64c1b235fc` (started 2026-05-12 19:16 UTC, cancelled while paused 2026-05-14 05:56 UTC)
- Repo: deimos (repository_id 156, 8280 files), workspace `scan_depth=100`

---

## 1. Confirmed root cause

**There is NO pipeline regression in the scanner.** The original premise — that the new run is invoking Sniper on 3-4× more modules than baseline — is **false**.

- Pre-classify produces a **byte-identical** classified-metadata.jsonl in both runs (md5 `5fcdbafe61b8e2981cddf31e5396ee6f`).
- Partitioner produces **the same 82 modules with the same names and almost-identical file_counts** in both runs.
- Baseline actually invoked Sniper on **all 82 modules**, not 19. The "19 sniper invocations" in baseline's `ai-research.log` is **the count from the final resume window only**, because `metrics: AgentMetric[]` in `runPipeline()` is reset to `[]` every time the step is re-entered after a rate-limit pause (`api/src/orchestrator/steps/scanner.ts:397-398`, line 522 writes the summary based on that array). The summary is written only when the step finishes successfully (line 526), so what gets persisted is "agent calls during the resume that finally completed the run", not "total agents across all resumes".
- Aligning module-for-module (66 modules present in both), the baseline ran Sniper on 6444 INTERESTING files and the new run on 6418 — a 26-file difference within ordinary repo drift (the repo had small changes between May 7 and May 13). Per-module Sniper wall time changed by an average of +7 seconds (2.6%) — pure noise.

**The actual regression is not "more Sniper work". It is "8× more rate-limit pauses, with a fixed-cost 4-5 hour wait per pause."** Anthropic's quota envelope tripped 9 times on the new account/run versus 1 time on the baseline, even though the underlying work is the same. Each trip forces a wait until `resetsAt`. That converts ~6 hours of active Sniper time into ~62 hours of wall-clock time.

File:line for the rate-limit handler: `api/src/orchestrator/rate-limit.ts:21-50` — `checkRateLimitAndPause` throws `ScanPausedError` carrying `resumesAt`, and `scanner.ts:475-477` catches it on a per-module basis and re-throws so the worker checkpoints the scan.

---

## 2. Evidence

### 2.1 scan_modules table — identical structure

```
                                       baseline | new
scan_modules rows                            82 |  67  (new was still running, module 66 'pending')
modules with file_count > 0                  82 |  67
modules with file_count = 0                   0 |   0
SUM(file_count) for modules 0-66           6444 | 6418  (-26 files, 0.4% drift)
AVG(file_count)                              93 |  96
MIN/MAX(file_count)                        4/150| 4/149
```

The 0-zero-file-modules result is the **opposite** of what the prompt expected ("baseline should have ~63 modules with file_count=0"). That expectation was wrong: baseline did NOT have most modules skipped — Sniper ran on every one.

### 2.2 Module names match 1:1

For all 66 modules present in both scans, `module_name` is identical (`root`, `client_applications_reagentsink`, `client_common_dataview_bc_constructor`, `dblogic_bc_part1`…`part17`, etc.). No `_part1/_part2` splits appeared or disappeared. The partitioner produced the same output both runs.

### 2.3 Per-module Sniper duration

```
                                  baseline | new
sum(per-module duration) 66 mods   18295s  | 18769s  (+2.6%)
avg delta per module                   --  | +7.2s   (noise)
total active Sniper time (full)    ~6h 24m | ~5h 13m for 66 of 82
```

### 2.4 Scout-unclear promotion (the only real numerical diff)

```
batch  baseline INTERESTING  new INTERESTING  diff
  0          479                  455         -24
  1          498                  495          -3
  2          382                  315         -67
total      1359                 1265         -94
```

Scout-unclear promoted **94 fewer** UNCLEAR-to-INTERESTING in the new run (TRASH grew from 32 to 126). This made the new run do **less** work, not more. Direction of effect is opposite to the user's hypothesis.

### 2.5 Rate-limit cycles

Baseline (from `scan_events`):
```
2026-05-07 21:53:53  ai-research paused (resets 00:00)
2026-05-08 00:08:36  Scan resumed
```
One pause. ~2h 15m idle.

New run (from `scan_events`):
```
2026-05-12 20:55:39  analysis paused      (resets 23:40)
2026-05-12 23:41:17  resumed
2026-05-13 00:36:51  ai-research paused   (resets 04:40)
2026-05-13 04:41:20  resumed
2026-05-13 05:47:32  ai-research paused   (resets 09:40)
2026-05-13 09:41:19  resumed
2026-05-13 10:46:19  ai-research paused   (resets 14:40)
2026-05-13 14:41:19  resumed
2026-05-13 15:24:07  ai-research paused   (resets 19:40)
2026-05-13 19:40:01  resumed
2026-05-13 19:45:08  ai-research paused   (resets 00:00)   ← 5 min of work!
2026-05-13 20:30:58  resumed
2026-05-13 21:27:11  ai-research paused   (resets 00:00)
2026-05-14 00:00:24  resumed
2026-05-14 00:52:24  ai-research paused   (resets 05:00)
2026-05-14 05:00:24  resumed
2026-05-14 05:56:54  ai-research paused   (resets 10:00)
```
Nine pauses, eight resumes. ~57m of work per ~5h cycle. Idle time dwarfs active time.

### 2.6 Step-level timing comparison

```
step           baseline_secs | new_secs   note
clone                     0  |       0    no-op (local path or already cloned)
analysis                570  |     757    new took 33% longer THIS RESUME ONLY
                                          (started 23:41:17 after pause at 20:55)
security-tools           93  |      83    same
ai-research            6695  |  pending   baseline value is JUST the final resume,
                                          actual wall-time was 17:04 May 7 → 02:00 May 8
                                          (≈9h with 1 rate-limit gap)
import                   38  |  pending
triage-report          1721  |  pending
```

`scan_steps.started_at` is overwritten on every resume (`api/src/orchestrator/pipeline.ts:198-200` — `updateStepStatus(stepId, 'running', { startedAt: new Date(), ... })`), so this column is **not a true wall-clock start**. The right source of truth for wall-clock is the first `scan_modules.started_at` (or the first ai-research `Scan resumed` event minus the original create time).

### 2.7 Container/code state

- Both runs used the same multi-stage pipeline (`partitioner.ts`, `pre-classifier.ts`, `mirror-builder.ts`, `linguist-classifier.ts` — all present in `/app/dist/orchestrator/steps/` inside the api container). The baseline run already had the "scanner pipeline restructure" deployed; this is not a new-version vs old-version story.
- The api image was rebuilt 2026-05-13 ~15:00 UTC, mid-run of the new scan. That rebuild did not change module structure — completed modules carry forward via `scan_modules.status='completed'` (`scanner.ts:459-463`).
- claude-runner image was rebuilt 2026-05-11 22:20 UTC. The scout-unclear prompt at `claude-container/prompts/scanner-scout-unclear.md` is **not in git history** (uncommitted file; host copy timestamp 2026-05-12 01:51 EEST = May 11 22:51 UTC). Whatever changed in that prompt between baseline and the rebuild is opaque from git, but the empirical effect is "94 fewer files promoted to INTERESTING", which makes Sniper do LESS work, not more.

---

## 3. What changed in git

**Nothing in the orchestrator/scanner pipeline.**

```
$ git log --since=2026-05-06 --until=2026-05-14 -- api/src/orchestrator/steps/ claude-container/prompts/
(no commits)
```

The most recent committed change to anything in `api/src/orchestrator/steps/` predates May 6 (latest tag is `544c9e9 Release v0.2.1` on 2026-04-09).

Working-tree is dirty (`scanner.ts` has 628 modified lines vs HEAD, `claude-container/prompts/scanner.md`, `analyzer.md`, `triage-and-report.md` also modified), but those changes are deployed in the running containers — they are not "the regression came in between May 7 and May 13", they are "this is the deployed pipeline since at least May 7 and it has not been re-committed".

The only out-of-git change between the two runs is the **claude-runner image rebuild on 2026-05-11 22:20 UTC**, which picked up edits to several prompts including `scanner-scout-unclear.md`. Empirical impact of those prompt edits on partitioning: -94 INTERESTING (less work). Not the cause of the slowdown.

---

## 4. Impact

For a repo of deimos's size (8280 files, ~7600 INTERESTING after scout), at `scan_depth=100`:

- Sniper active time: ~5–6.5h (82 modules × ~250s mean)
- Anthropic 5h-window quota: empirically ~50–65 minutes of Sniper work consumes one full window
- Therefore expected wall-clock at current quota: `(active_minutes / 55) * 5h ≈ 8 windows × 5h = 40h` for an 8000-file repo

The pipeline is fundamentally rate-limit-bound for large repos. Baseline got lucky and stayed inside one full quota window plus one small overflow; the new run hit a tighter envelope and could not catch up.

Scaling implication: any repo with > ~1h of total Sniper time will require multiple rate-limit cycles. Each cycle adds 3-5h of pure wait.

---

## 5. Recommended fix

This is not a regression to "fix" by reverting code; the pipeline behaves identically. The real problems and proposed work:

1. **Misleading summary in `ai-research.log` (real bug worth fixing).** `runPipeline` writes `summarizeMetrics(metrics, …)` using only the metrics array of the latest resume. A long-running multi-resume scan produces a summary that under-reports cost and agent count by an order of magnitude (the baseline's "$44.15 / 22 agents" is wrong — actual cumulative cost across all resumes is unknown but is at minimum 82 modules × ~$2 = ~$160). Fix: persist agent metrics to a JSONL file on the runner per call (or to a DB table) and aggregate from that file when writing the summary. File: `api/src/orchestrator/steps/scanner.ts:398, 522, 526`.

2. **`scan_steps.started_at` is overwritten on resume (data-quality bug).** Code at `api/src/orchestrator/pipeline.ts:198-200` blindly sets `startedAt: new Date()` every time the step re-enters running. Means we have no record of the original step start, which is what we need to measure wall-clock. Fix: set `startedAt` only if `status='pending'` AND `started_at IS NULL`.

3. **Rate-limit-bound scaling (the actual issue the user is hitting).** Options, in increasing intrusiveness:
   - **Run Sniper sequentially across multiple Anthropic accounts/keys** — round-robin to maximize parallelism within rate limits. Requires multi-account support in `ai-models.ts` / claude-runner config.
   - **Bigger partitions** (raise `scan_depth` to 500 or 1500) — fewer Sniper invocations means fewer round-trip cache-creates per quota window. Trade-off: less resilience (one module failing loses more findings).
   - **Pre-skip Sniper on modules where pre-classify already covers them well** — modules of pure `dblogic_bc_partN` look like a hot spot (17 parts × ~7m = ~2h of Sniper time on what is structurally repetitive DB code).
   - **Switch Sniper to Sonnet for small modules** (file_count < 30); reserve Opus for the genuinely complex ones. Saves quota for where it matters.

4. **Detect and log "5-minute zombie cycles".** The 2026-05-13 19:40→19:45 cycle did zero useful work because the quota was already exhausted on the previous wave. The scheduler should detect "resumed → immediate pause" and back off longer (e.g. 30+ min) instead of looping into another wait cycle.

---

## 6. Effect on ToB skills A/B conclusion

**No effect.** The Trail of Bits skills A/B comparison was done within the same pipeline version on smaller test repos, where each side completed inside a single rate-limit window. The phenomenon described above (multiple-window blow-up) is a wall-clock and cost concern for `scan_depth=100` on large repos like deimos. It does not change finding counts, finding quality, or which side of the A/B wins — those depend on Sniper output content, not on how many rate-limit pauses happened on the way to producing it.

The only collateral risk: if the A/B was rerun on deimos at `scan_depth=100`, you might see one side finish and the other still paused, making "wall clock per side" incomparable. Stick with the smaller benchmark targets for fair A/B, or measure on `active_module_time_seconds = SUM(scan_modules.completed_at - started_at)` instead of wall clock.
