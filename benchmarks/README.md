# BEAST benchmarks

How we measure whether a change to BEAST's AI pipeline actually makes scans better —
and the experiments we have run so far. Every number in this folder comes from real
scans of real repositories; the raw data sits next to each report.

## Experiments

| Experiment | When | Question | Runs | Outcome |
|---|---|---|---:|---|
| [Sniper module-size sweep](2026-05-sniper-module-size/REPORT.md) | May 2026 | How many files should one AI agent analyse at once? | 6 | Module size changes **volume**, not vulnerability **class**. Set the `scan_depth` presets 100 / 500 / 1500 |
| [Trail of Bits skills A/B](2026-05-tob-skills-ab/REPORT.md) | May 6–14, 2026 | Do bundled ToB skills improve the AI scanner? | 17 | **Void** — the skills never loaded ([postmortem](2026-05-tob-skills-ab/POSTMORTEM.md)). Kept as a measurement of run-to-run variance; surfaced 5 pipeline bugs |

23 benchmark runs in total, on 5 target repositories.

## Target repositories

Fixed set, so results stay comparable release to release.

| Tier | Repo | Lines of code | Files | Size |
|---|---|---:|---:|---:|
| Small | `Kalantiernaia/cosmetic_bot` | 57 | 7 | 152 KB |
| Small | `BenTelega/samokatbot` | 995 | 51 | 412 KB |
| Medium | `bluesaturn1/rltrader` | 66 016 | 187 | 28 MB |
| Medium | `mansarkasim-cpu/sigap-planner` | 34 336 | 617 | 175 MB |
| Large | `deimos` (private) | 731 201 | 8 280 | 114 MB |
| Large | `phobos` (private) | 1 925 453 | 27 154 | 276 MB |

The four public repos are third-party projects with known, real vulnerabilities — a
ground truth we can verify by reading the code. `phobos` is excluded from routine runs:
too large to finish inside an overnight rate-limit window.

## Methodology

### 1. Change one thing

Both arms run in a dedicated workspace with everything pinned except the treatment:

- same target commit for every repo
- same `scan_depth` (benchmarks default to 100 — the deepest setting)
- same models per stage (analyzer, scanner, triage) and the same AI step toggles
- same pipeline build; only the treatment differs (a skill bundle, a prompt, a module size)

### 2. Prove the treatment reached the process under test

Inspecting the image is not enough. The ToB A/B checked `/root/.claude/skills/` while
the scanner runs as user `scanner` and read `/home/scanner/.claude/skills/` — empty. The
"with skills" arm differed from baseline only by prompt lines pointing at skills that were
not there, and two weeks of analysis measured that plus noise. Verify from inside the running process, as the user
it runs as, before the first scan.

### 3. Never compare finding counts

LLM output is non-deterministic, and counts are easy to move without changing signal:

- **splitting** — one leaked credential reported once per file (`.env`, `.env.sh`, `.env.backup`)
- **severity inflation** — a Medium re-labelled High
- **granularity** — five SQL sinks on consecutive lines reported as one finding or five

In the ToB A/B a run with **+7 Highs** contained **zero** new real ones (5 splits,
2 inflations) and silently lost 5 real Highs. We compare:

- the `beast` (AI) tool column only, when testing an AI change — the deterministic
  tools (semgrep, gitleaks, trivy…) drift independently and blur the signal
- Critical + High only
- **semantic matching**, not exact fingerprints: same file, start line within ±10,
  and `SequenceMatcher ≥ 0.55` on title, description or snippet. Exact
  `(file, line, CWE, title)` fingerprints reported a 1–2 % overlap between module sizes;
  semantic matching showed the real figure is 24–78 %
- **directional** overlap (A→B ≠ B→A) — set sizes differ by up to 15×

### 4. Verify findings against the source

Every Critical/High that differs between arms is opened in the target repo and classified:

| Class | Meaning |
|---|---|
| unique-new-legit | real bug, absent from the other arm |
| splits-existing | an existing finding cut into pieces |
| dup-of-baseline | same bug, reported in another form |
| severity-inflation | same bug, higher severity |
| hallucination | the described vulnerability is not in the code |
| missed | real bug the other arm found and this one lost |

Measured on 14 sigap-planner Highs: 0 % hallucination, 36 % splitting, 21 % duplicates,
14 % severity inflation, 21 % genuinely new.

### 5. Measure the noise floor

Re-run a subset with an identical configuration. A difference smaller than the
re-run spread is noise. Two identical samokatbot runs two days apart gave 2 and 1 Highs;
the baseline had 9, and once the treatment turned out not to have applied, that gap could
no longer be told apart from drift. With five repos, only a large effect is detectable.

### 6. Separate cost from rate limits

Wall-clock on large repos is dominated by provider rate limits, not by the pipeline: the
deimos "regression" was 1 rate-limit pause versus 9 on identical work. Report pause count
next to duration, and run large repos alone. Cost and token usage come from the per-agent
stream-json logs stored in `scan_files`, aggregated with
[`tools/aggregate-metrics.ts`](tools/README.md).

### 7. Keep private code out

Reports on private repos contain aggregates only — no paths, snippets or finding
details. Literal credential values found in third-party repos are redacted.

## What changed in BEAST because of these benchmarks

- `scan_depth` presets **100 / 500 / 1500** files per agent, from the module-size sweep —
  smaller modules find more instances of the same classes at a higher cost
- the ToB skills bundle was rolled back; ToB coverage stays via the deterministic
  `p/trailofbits` semgrep ruleset
- pipeline bugs found while running the A/B: scout-stage Claude calls re-run on every
  resume, a 10-minute worker probe interval, multi-resume duration undercount,
  `scan_steps.started_at` overwritten on resume, and metrics aggregation missing
  `ai-research` logs — [the list](2026-05-tob-skills-ab/PIPELINE-BUGS-AND-DECISIONS.md)
  records the fix proposed for each
- the methodology above

## Layout

```
benchmarks/
  README.md                        this file
  tools/                           reusable tooling (see tools/README.md)
    aggregate-metrics.ts           per-scan token, cost and duration from scan_files
    bench-sniper.ts                re-run only the partitioner + Sniper with a given module size
    overlap_analysis.py            semantic overlap between finding sets
  2026-05-sniper-module-size/
    REPORT.md
  2026-05-tob-skills-ab/
    POSTMORTEM.md                  read first
    REPORT.md                      original comparison
    FINDINGS-FORENSIC.md           per-finding classification
    PIPELINE-BUGS-AND-DECISIONS.md
    DEIMOS-PIPELINE-REGRESSION.md
    PROTOCOL.md                    run protocol
    data/                          scan queues, raw metrics, baseline counts
```

New experiments go in `YYYY-MM-<topic>/` with a `REPORT.md` and their raw data in `data/`.
