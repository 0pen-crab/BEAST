# Trail of Bits skills — Benchmark comparison

> **⚠ Superseded — read `POSTMORTEM.md` first.** In June we found the skills never
> loaded; the arms differed only by prompt lines referencing absent skills. The
> differences below are not a skill effect. Kept as a measurement of run-to-run variance.

**Date:** 2026-05-14
**Goal:** quantify whether bundling Trail of Bits skills into the `claude-runner` image improved BEAST scan output (more / higher-quality findings, without unreasonable cost or duration regressions).

> **This report has been REWRITTEN** after two forensic subagent investigations overturned
> the original conclusions. See `FINDINGS-FORENSIC.md` and `DEIMOS-PIPELINE-REGRESSION.md`
> for the detailed source material.

## TL;DR — verdict

**The ToB skills bundle is NET NEGATIVE on this benchmark.** Headline counts looked
positive, but finding-by-finding source verification shows that:

* The "+18% High findings" claim from the first version of this report came from
  counting splits and re-severitied findings, not new signal.
* Skills regressed cosmetic_bot (2 → 0 Highs) and samokatbot (9 → 2 Highs); they shuffled
  coverage on rltrader; on sigap-planner the count went up by 8 but real-signal Highs
  went DOWN by ≥2 (5 real bugs from baseline were dropped).
* On the cleanest experiment — sigap-planner WITH skills vs same repo WITH skills disabled
  but same pipeline — 0 of the +7 "extra" Highs were truly new legitimate findings.
  See `FINDINGS-FORENSIC.md` for the per-finding classification.

**Recommendation: do NOT keep the bundled skill set in production scans.** Either roll
back, or scope to one skill at a time and re-benchmark each in isolation.

The deimos "slowdown" was also misdiagnosed in the first version of this report. The
pipeline did NOT regress — Sniper ran on the same 82 modules in both runs. The wall-clock
explosion was from Anthropic rate-limit exposure (1 pause vs 9 pauses). See
`DEIMOS-PIPELINE-REGRESSION.md`.

## Methodology

| | Value |
|---|---|
| Workspace | `bebench` (id 16) |
| Scan depth | **100 (DEEP)** for both baseline and new run |
| Models | analyzer=`sonnet-4-6`, scanner=`opus-4-6[1m]`, triage=`opus-4-6[1m]` |
| AI flags | analyzer ON, scanner ON, triage ON |
| Repos | cosmetic_bot, samokatbot, rltrader, sigap-planner, deimos (phobos excluded) |
| Baseline run | 2026-05-06 / 2026-05-07 (before ToB skills bundled in image) |
| New run | 2026-05-12 (with `claude-container/skills/trailofbits/` baked into the image) |
| A/B test | 2026-05-14 — sigap-planner with skills disabled mid-pipeline, all other variables identical |

**Important caveat.** Although baseline and new-run pre-classify outputs are byte-identical
for deimos, the system is non-deterministic at the Claude-output level — same files into
Claude can produce slightly different findings each run. Reproducibility was therefore
spot-checked via a re-run of all 4 small repos on 2026-05-14 with skills still enabled.
Results are stable enough to draw conclusions.

## Headline numbers

### `beast` tool findings — count (before vs after)

| Repo | Before (baseline) | After (with ToB skills) | Δ findings | Δ % | Δ High (count) | Δ High (signal) |
|---|---|---|---|---|---|---|
| cosmetic_bot | 5 (H2/M1/L2) | 6 (H2/M1/L3) | +1 | +20% | 0 | **−2 (lost both real Highs)** |
| samokatbot | 19 (H9/M7/L3) | 18 (H8/M7/L3) | −1 | −5% | −1 | **−7 (lost 7 real Highs)** |
| rltrader | 26 (H13/M8/L5) | 39 (H24/M9/L6) | +13 | +50% | +11 | **+2 (2 new real, ≥3 real lost)** |
| sigap-planner | 78 (H30/M33/L15) | 78 (H32/M31/L15) | 0 | 0% | +2 | **−5 (real Highs dropped)** |

Note: the "before" `beast` counts include findings of every status (open + duplicate +
risk_accepted + false_positive). The Highs column is more meaningful — and it is wrong to
use it without forensic verification, because Claude can split one credential leak across
N files or upgrade a Medium to High and the count moves while the underlying signal does
not. See `FINDINGS-FORENSIC.md` for the per-finding classification.

### A/B test — sigap-planner with vs without skills (same pipeline)

This is the cleanest data point because both sides ran on the same scanner pipeline
within 48 hours of each other, with everything except the skill directory and the
"Available Skills" prompt sections held constant.

| Metric | WITH skills (09d44587) | NO skills (e3b52558) | Δ |
|---|---|---|---|
| Wall clock | 36.0 min | 35.0 min | −3% |
| Total cost | $10.75 | $9.98 | −7% (cheaper without) |
| `beast` Highs | 14 | 7 | +7 |
| `beast` Highs — TRULY NEW LEGIT | 3 | — | — |
| `beast` Highs — splits / dups / severity-inflation | 11 | — | — |
| `beast` Highs MISSED that baseline found | ≥5 | varies | — |
| Avg Sniper duration | 3.06 min | 2.74 min | −10% |
| Analyzer turns | 44 | 59 | +34% (more turns without skills) |

Of the +7 High count delta: 5 are pure splits, 2 are severity inflation. **Zero of the +7
are truly new legitimate findings.** Meanwhile the WITH-skills run LOST ≥5 real
High-severity bugs from baseline that NO-skills covered. Net signal: **−2 real Highs
hidden behind a +7 count**.

## Full per-repo comparison

### cosmetic_bot — REGRESSION

| Metric | Before | After | Δ |
|---|---|---|---|
| `beast` findings | 5 | 6 | +1 |
| `beast` Highs (counted) | 2 | 2 | 0 |
| `beast` Highs (real and unique) | **2** | **0** | **−2** |
| Wall clock | 7.8 min | 10.2 min | +2.4 min |
| Total cost | $1.26 | $1.33 | +5% |

Baseline correctly flagged the real Telegram bot token and OpenAI API key committed to
`.env` and `.env.example`. WITH-skills replaced these with one Medium ("OPENAI_API_KEY
loaded but unused" — downgraded AND misses the actual exposure) and one Low ("python-dotenv
unpinned"). Verified on 2 separate skill-enabled runs; the regression reproduces.

### samokatbot — REGRESSION

| Metric | Before | After | Δ |
|---|---|---|---|
| `beast` findings | 19 | 18 | −1 |
| `beast` Highs (counted) | 9 | 8 | −1 |
| `beast` Highs (real and unique) | **9** | **2** | **−7** |
| Wall clock | 12.8 min | 17.0 min | +33% |
| Total cost | $2.58 | $2.55 | −1% |

Baseline caught 9 real Highs (hardcoded `BOT_TOKEN` in `.env` AND in `p.py:9`, HTML
injection via `ParseMode.HTML` + user-controlled name, no-auth POST endpoint, IDOR,
spoofable admin auth, admin panel via query param, unauthenticated webhook, missing
webhook secret_token). WITH-skills kept only the IDOR and partially the spoofable admin.
**Dropped 7 real Highs**, including the hardcoded bot token plainly visible in two
separate files.

### rltrader — SLIGHT REGRESSION (counts say +50%, signal says ~flat)

| Metric | Before | After | Δ |
|---|---|---|---|
| `beast` findings | 26 | 39 | +13 |
| `beast` Highs (counted) | 13 | 24 | +11 |
| `beast` Highs (real and unique-new) | — | **2** | — |
| `beast` Highs (lost from baseline) | — | **≥3** | — |
| Wall clock | 31.6 min | 28.3 min | −10% |
| Total cost | $4.98 | $5.61 | +13% |

Of the +11 Highs, 2 are truly new legit catches (`torch.load` pickle deser, Streamlit
text_input → SQL via table name). The remainder shuffle the "systemic SQL-injection clone"
pattern across 7 different files than baseline covered, while losing baseline's catches
of hardcoded Telegram bot token in `cf.py:8` and hardcoded MySQL password in `main.py:29`.

### sigap-planner — COUNT INFLATED, SIGNAL DROPPED

| Metric | Before | After | Δ |
|---|---|---|---|
| `beast` findings | 78 | 78 | 0 |
| `beast` Highs (counted) | 30 | 32 | +2 |
| `beast` Highs (truly new + legit) | — | **3** | — |
| `beast` Highs (splits + dups + severity inflation) | — | **8** | — |
| `beast` Highs MISSED that baseline found | — | **5+** | — |
| Wall clock | 31.4 min | 36.0 min | +15% |
| Total cost | $12.60 | $10.75 | −15% |

WITH-skills found 3 genuinely new Highs (JWT secret fallback in `authController.ts:8`,
no-auth `userImportController.ts:20`, RouteGuard `startsWith('/')` bug). But it ALSO
dropped 5+ real Highs from baseline coverage: DOM XSS in `monitor/daily-weekly/page.jsx`,
NULL-password admin user in migration 015, hardcoded SIGAP bearer in
`workOrderController.ts:15`, middleware not validating JWT in `middleware.js`, no rate
limit on login in `authController.ts:66`, plaintext passwords logged in `api-client.ts:88`.

**File overlap:** of all flagged files, only 3 appear in both runs. Skills are pulling
Claude's attention to different files than baseline — and the files baseline covered
contained more severe bugs than the new ones.

### deimos — INCONCLUSIVE (rate-limit exhaustion, not a skill or pipeline issue)

| Metric | Before (2026-05-07) | After (2026-05-13–14) |
|---|---|---|
| Status | completed | cancelled (rate-limit loop) |
| Pre-classify counts | 665/3/6221/1391 | 665/3/6221/1391 (identical) |
| Partition modules | 82 | 82 (identical) |
| **Sniper modules actually run** | **82** (corrected — see DEIMOS-PIPELINE-REGRESSION.md) | 66+ before cancel |
| Wall clock | 2.35 h, 1 rate-limit pause | 62 h, 9 rate-limit pauses |
| Active Sniper time | ~6h | ~5h 13m so far |

The original "baseline ran only 19 Sniper modules" finding was a **reporting bug** — the
metrics array in `runPipeline()` is reset on every resume, so the log summary shows only
the last window's metrics. Baseline actually ran 82 modules; the $44.15 in its log is only
the final resume's cost, not the run total.

Both runs do the same amount of underlying work. The difference is purely rate-limit
exposure: baseline got lucky and hit only 1 pause; the new run hit 9, each costing ~5h of
wait. Skills are not the cause. See `DEIMOS-PIPELINE-REGRESSION.md` for the full root
cause and the proposed fixes.

## Per-finding forensic — what changed

`FINDINGS-FORENSIC.md` contains the per-finding classification used to derive the "real
signal" columns above. Summary statistics from that audit:

- **Hallucination rate**: 0% on the WITH-skills Highs we audited. Skills don't make up
  findings out of thin air.
- **Splitting rate**: 36% of new Highs are the same vulnerability described against
  multiple files (`.env`, `.env.sh`, `.env.backup` × {3 different creds}).
- **Severity inflation rate**: 14% of new Highs were Mediums in baseline.
- **Truly novel-and-legit rate**: 21% — only 3 of 14 sigap WITH-skills Highs.
- **Regression rate**: ≥5 real baseline Highs lost on sigap, 7/9 on samokatbot, 2/2 on cosmetic_bot, ≥3 on rltrader.

## Why this happened (hypothesis)

The skills prompt adds a fixed budget of context that Claude must reference when
classifying findings. By directing attention toward specific patterns (skills'
specialties), the agent appears to under-cover patterns the skills don't explicitly call
out — even when those patterns are the most damaging in the actual repo. The exception is
when a skill directly maps to a hot bug class (e.g. `insecure-defaults` catches
client-side auth bypasses well, hence the 2 severity-inflation cases on sigap).

The cost is also not properly amortized: the skill content adds tokens to every Sniper
session, so any benefit must offset that cost. On these 4 small repos, the benefit is
negative.

## Recommended action

1. **Disable the bundled skills** in the `claude-runner` image until a single-skill A/B
   isolates which (if any) carry positive signal. Most likely candidates to keep:
   - `insecure-defaults` (correlates with the severity-inflation wins on client-auth)
   - `entry-point-analyzer` (no direct evidence either way, but architecturally sound)
2. **Stop using count-based comparisons.** Introduce a finding-fingerprint
   (file+line+CWE+canonical-title hash) and compare by overlap, not totals.
3. **Add a deterministic secret-scan** independent of the skill bundle: every value in a
   committed `.env*` file that isn't an obvious placeholder is automatically a High
   regardless of what the AI says. Both regressed repos (cosmetic_bot, samokatbot) failed
   here.
4. **Fix the multi-resume reporting bug** so the log-ai-research summary reflects the
   FULL run's cost and agent count, not just the final window
   (`api/src/orchestrator/steps/scanner.ts:398, 522, 526`).
5. **Fix `scan_steps.started_at` overwrite on resume** so we can measure true wall-clock
   per step (`api/src/orchestrator/pipeline.ts:198-200`).
6. **Add zombie-cycle detection** in the worker: if a scan resumes and pauses within
   < 10 min, back off longer than the next API-reported reset time (one of the deimos
   cycles did exactly 5 min of work before pausing again).

## Artifacts

* `FINDINGS-FORENSIC.md` — full per-finding classification, code verification details, and the basis for the "real signal" columns in this report.
* `DEIMOS-PIPELINE-REGRESSION.md` — root cause analysis on the wall-clock explosion, the multi-resume reporting bug, and the rate-limit-cycle data.
* `aggregate-metrics.ts` (in `benchmarks/tools/`) — reusable tool used to produce per-scan / per-agent token and cost data for all runs.
* `data/raw-baseline.json`, `data/raw-baseline.md` — full agent breakdown for the 5 baseline scans.
* `data/raw-new.json`, `data/raw-new.md` — same for the 5 new scans (deimos partial).
* `data/raw-ab-sigap.md` — sigap WITH-vs-NO-skills A/B aggregation.
* `data/baseline-counts.csv` — repo-level open findings snapshot taken before the new run.
* `data/scan-queue.json` — original 5 new scan IDs.
* `data/confirmation-reruns.json` — 2026-05-14 rerun scan IDs (in flight at report time).
