# Benchmark — Token & Cost Aggregation

Generated: 2026-05-13T15:47:59.505Z
Scans: 5

## Summary

| Repo | Status | Depth | Wall (scan.duration_ms) | Σ agent duration | Cost | Input | Output | Cache R | Cache C | Cache hit |
|---|---|---|---|---|---|---|---|---|---|---|
| cosmetic_bot | completed | 100 | 10.2min | 10.0min | $1.3318 | 2.9K | 27.2K | 976.0K | 88.5K | 91.7% |
| samokatbot | completed | 100 | 17.0min | 16.8min | $2.5548 | 3.2K | 52.1K | 1.58M | 158.4K | 90.9% |
| rltrader | completed | 100 | 28.3min | 28.1min | $5.6138 | 7.1K | 78.5K | 4.27M | 374.4K | 91.9% |
| sigap-planner | completed | 100 | 36.0min | 35.6min | $10.7508 | 18.7K | 126.6K | 7.48M | 981.0K | 88.4% |
| deimos | paused | 100 | — | 12.6min | $2.1565 | 823 | 39.3K | 3.86M | 109.0K | 97.3% |

## Grand totals

- Total cost: **$22.4077**
- Total input tokens: **32.7K**
- Total output tokens: **323.8K**
- Total cache read: **18.17M**
- Total cache create: **1.71M**
- Agent invocations: **21**
- Agent errors: **0**
- Σ agent duration: **1.72h**

## Per-scan agent breakdown

### cosmetic_bot (5524663e)

- scan_type: full, status: completed, depth: 100
- wall: 10.2min, agents: 4, errors: 0

| Agent | Primary model | Turns | Duration | Cost | Input | Output | Cache R | Cache C |
|---|---|---|---|---|---|---|---|---|
| scout-unclear:0 | claude-sonnet-4-6 | 0 | 16.2s | $0.0648 | 673 | 765 | 73.3K | 8.2K |
| sniper:root | claude-opus-4-6[1m] | 0 | 46.2s | $0.1582 | 658 | 2.6K | 54.6K | 10.4K |
| analyzer | claude-sonnet-4-6 | 29 | 5.7min | $0.5234 | 771 | 15.0K | 607.8K | 30.9K |
| triage | claude-opus-4-6[1m] | 23 | 3.3min | $0.5854 | 824 | 8.8K | 240.3K | 39.0K |

### samokatbot (a0d0bb7b)

- scan_type: full, status: completed, depth: 100
- wall: 17.0min, agents: 4, errors: 0

| Agent | Primary model | Turns | Duration | Cost | Input | Output | Cache R | Cache C |
|---|---|---|---|---|---|---|---|---|
| scout-unclear:0 | claude-sonnet-4-6 | 0 | 34.6s | $0.0940 | 676 | 2.0K | 75.6K | 10.9K |
| sniper:root | claude-opus-4-6[1m] | 0 | 3.1min | $0.5346 | 922 | 10.2K | 129.1K | 34.2K |
| analyzer | claude-sonnet-4-6 | 43 | 6.8min | $0.7051 | 776 | 18.3K | 836.4K | 47.6K |
| triage | claude-opus-4-6[1m] | 29 | 6.4min | $1.2211 | 832 | 21.6K | 541.0K | 65.7K |

### rltrader (c32da9a8)

- scan_type: full, status: completed, depth: 100
- wall: 28.3min, agents: 5, errors: 0

| Agent | Primary model | Turns | Duration | Cost | Input | Output | Cache R | Cache C |
|---|---|---|---|---|---|---|---|---|
| scout-unclear:0 | claude-sonnet-4-6 | 0 | 3.6min | $0.1288 | 679 | 3.6K | 78.5K | 13.3K |
| sniper:root | claude-opus-4-6[1m] | 0 | 2.9min | $1.3498 | 1.3K | 10.1K | 758.9K | 114.8K |
| sniper:myenv_include_site_python3_10_greenlet | claude-opus-4-6[1m] | 0 | 1.9min | $0.6563 | 941 | 6.6K | 163.5K | 65.6K |
| analyzer | claude-sonnet-4-6 | 46 | 6.8min | $1.1360 | 788 | 18.0K | 1.92M | 76.8K |
| triage | claude-opus-4-6[1m] | 45 | 12.9min | $2.3429 | 3.3K | 40.2K | 1.35M | 103.8K |

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

### deimos (c8ab5d3b)

- scan_type: full, status: paused, depth: 100
- wall: —, agents: 1, errors: 0

| Agent | Primary model | Turns | Duration | Cost | Input | Output | Cache R | Cache C |
|---|---|---|---|---|---|---|---|---|
| analyzer | claude-sonnet-4-6 | 88 | 12.6min | $2.1565 | 823 | 39.3K | 3.86M | 109.0K |
