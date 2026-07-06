# BEAST benchmark scripts

Reusable tooling for measuring BEAST scans across runs. Used for release-to-release
comparisons and skill-effectiveness experiments.

## aggregate-metrics.ts

Aggregates AI token and cost metrics from `scan_files` (the stream-json output
saved per Claude CLI invocation). Outputs JSON and/or markdown.

### Install

```
cd scripts/benchmark
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
