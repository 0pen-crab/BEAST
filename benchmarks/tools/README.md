# BEAST benchmark scripts

Reusable tooling for measuring BEAST scans across runs. Used for release-to-release
comparisons and skill-effectiveness experiments.

## aggregate-metrics.ts

Aggregates AI token and cost metrics from `scan_files` (the stream-json output
saved per Claude CLI invocation). Outputs JSON and/or markdown.

### Install

```
cd benchmarks/tools
npm install
```

### Usage

```bash
# By explicit scan IDs
DATABASE_URL=postgresql://beast:beast_dev_password@localhost:5432/beast \
  npx tsx aggregate-metrics.ts --scans=<uuid>,<uuid>,...

# All scans for a list of repos since a date
npx tsx aggregate-metrics.ts --repos=151,152,153,154,156 --since=2026-05-12

# All scans in a workspace within a window
npx tsx aggregate-metrics.ts --workspace=16 --since=2026-05-12 --until=2026-05-13

# Write both JSON and markdown
npx tsx aggregate-metrics.ts \
  --workspace=16 --since=2026-05-12 \
  --out-json=raw.json --out-md=report.md
```

### What it captures (per scan)

* `agents[]` — one entry per Claude CLI invocation (analyzer, triage, ai-research,
  scanner:<module>, sniper-fail, etc.). For each:
  - `primaryModel` — the model with the highest cost (the one doing real work)
  - `inputTokens` / `outputTokens` / `cacheRead` / `cacheCreate` / `costUSD`
  - `durationMs` (per Claude session), `numTurns`, `isError`
* `totals` — sum across all agents for the scan
* Wall clock from `scans.duration_ms` and start/completed timestamps

### Data source

Each Claude invocation's raw stdout (stream-json) is persisted by the orchestrator
as a `scan_files` row with `file_type LIKE 'log-%'`. The aggregator finds the
last `result` event in each file and reads its `total_cost_usd`, `duration_ms`,
`num_turns`, and `modelUsage` fields.

## bench-sniper.ts

Re-runs only the partitioner and Sniper stages of an existing scan with a different
module size, reusing that scan's mirror, classified metadata and Scout results — so a
module-size sweep costs Sniper calls only. Used for `../2026-05-sniper-module-size/`.

```bash
# from the repo root; imports resolve against api/
api/node_modules/.bin/tsx benchmarks/tools/bench-sniper.ts \
  --scan-id <uuid> --target 500 --max 650 [--parallel 4]
```

Writes `bench-out/<scan-id>/target-<N>/` with per-module findings, per-module metrics and
an aggregate `summary.json` (cost, findings, density, $/finding).

## overlap_analysis.py

Semantic overlap between finding sets of several configurations: same file, start line
within ±10, `SequenceMatcher ≥ 0.55` on title, description or snippet. Prints the exact
and fuzzy overlap matrices and the per-config reproduction rate. Reads
`/tmp/bench-all-<N>.json` (one finding list per configuration).

```bash
python3 overlap_analysis.py
```
