# Benchmark — Token & Cost Aggregation

Generated: 2026-05-14T10:49:18.263Z
Scans: 2

## Summary

| Repo | Status | Depth | Wall (scan.duration_ms) | Σ agent duration | Cost | Input | Output | Cache R | Cache C | Cache hit |
|---|---|---|---|---|---|---|---|---|---|---|
| sigap-planner | completed | 100 | 35.0min | 34.6min | $9.9794 | 9.4K | 123.4K | 7.24M | 778.2K | 90.3% |
| sigap-planner | completed | 100 | 36.0min | 35.6min | $10.7508 | 18.7K | 126.6K | 7.48M | 981.0K | 88.4% |

## Grand totals

- Total cost: **$20.7302**
- Total input tokens: **28.1K**
- Total output tokens: **250.0K**
- Total cache read: **14.72M**
- Total cache create: **1.76M**
- Agent invocations: **14**
- Agent errors: **0**
- Σ agent duration: **1.17h**

## Per-scan agent breakdown

### sigap-planner (e3b52558)

- scan_type: full, status: completed, depth: 100
- wall: 35.0min, agents: 7, errors: 0

| Agent | Primary model | Turns | Duration | Cost | Input | Output | Cache R | Cache C |
|---|---|---|---|---|---|---|---|---|
| scout-unclear:0 | claude-sonnet-4-6 | 0 | 1.8min | $0.2238 | 676 | 8.3K | 84.5K | 19.7K |
| sniper:root | claude-opus-4-6[1m] | 0 | 1.7min | $0.3701 | 738 | 5.7K | 59.8K | 31.7K |
| sniper:backend_migration | claude-opus-4-6[1m] | 0 | 2.7min | $0.8796 | 1.7K | 10.0K | 123.1K | 90.8K |
| sniper:backend_scripts | claude-opus-4-6[1m] | 0 | 3.8min | $1.7937 | 2.9K | 12.8K | 796.7K | 171.7K |
| sniper:mobile_macos_runner_configs | claude-opus-4-6[1m] | 0 | 2.8min | $2.0498 | 1.7K | 9.5K | 1.03M | 207.0K |
| analyzer | claude-sonnet-4-6 | 59 | 8.3min | $1.7600 | 798 | 28.2K | 3.27M | 95.1K |
| triage | claude-opus-4-6[1m] | 28 | 13.6min | $2.9024 | 863 | 49.0K | 1.88M | 162.3K |

### sigap-planner (09d44587)

- scan_type: full, status: completed, depth: 100
- wall: 36.0min, agents: 7, errors: 0

| Agent | Primary model | Turns | Duration | Cost | Input | Output | Cache R | Cache C |
|---|---|---|---|---|---|---|---|---|
| scout-unclear:0 | claude-sonnet-4-6 | 0 | 2.0min | $0.2602 | 662 | 9.3K | 112.3K | 23.0K |
| sniper:root | claude-opus-4-6[1m] | 0 | 1.9min | $0.3642 | 733 | 5.7K | 59.2K | 30.5K |
| sniper:backend_migration | claude-opus-4-6[1m] | 0 | 3.3min | $0.6770 | 1.7K | 10.6K | 314.1K | 40.5K |
| sniper:backend_scripts | claude-opus-4-6[1m] | 0 | 3.7min | $1.7681 | 2.9K | 12.7K | 1.03M | 149.2K |
| sniper:mobile_test | claude-opus-4-6[1m] | 0 | 3.3min | $3.4025 | 3.9K | 11.3K | 644.0K | 445.7K |
| analyzer | claude-sonnet-4-6 | 44 | 7.4min | $1.1360 | 768 | 22.0K | 1.64M | 83.4K |
| triage | claude-opus-4-6[1m] | 45 | 13.9min | $3.1428 | 8.0K | 54.9K | 3.68M | 208.6K |
