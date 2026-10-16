# Benchmark — Token & Cost Aggregation

Generated: 2026-05-13T11:01:31.648Z
Scans: 5

## Summary

| Repo | Status | Depth | Wall (scan.duration_ms) | Σ agent duration | Cost | Input | Output | Cache R | Cache C | Cache hit |
|---|---|---|---|---|---|---|---|---|---|---|
| cosmetic_bot | completed | 100 | 7.8min | 7.6min | $1.2619 | 2.9K | 22.5K | 970.9K | 85.5K | 91.9% |
| samokatbot | completed | 100 | 12.8min | 12.6min | $2.5818 | 3.2K | 41.9K | 1.63M | 200.7K | 89.0% |
| rltrader | completed | 100 | 31.6min | 31.3min | $4.9784 | 5.4K | 86.5K | 3.62M | 320.0K | 91.9% |
| sigap-planner | completed | 100 | 31.4min | 30.9min | $12.6013 | 24.9K | 131.8K | 6.90M | 1.14M | 85.9% |
| deimos | completed | 100 | 2.35h | 2.49h | $56.2883 | 50.8K | 508.0K | 30.46M | 4.93M | 86.1% |

## Grand totals

- Total cost: **$77.7117**
- Total input tokens: **87.2K**
- Total output tokens: **790.7K**
- Total cache read: **43.58M**
- Total cache create: **6.67M**
- Agent invocations: **43**
- Agent errors: **0**
- Σ agent duration: **3.86h**

## Per-scan agent breakdown

### cosmetic_bot (c1059120)

- scan_type: full, status: completed, depth: 100
- wall: 7.8min, agents: 4, errors: 0

| Agent | Primary model | Turns | Duration | Cost | Input | Output | Cache R | Cache C |
|---|---|---|---|---|---|---|---|---|
| scout-unclear:0 | claude-sonnet-4-6 | 0 | 19.6s | $0.0685 | 667 | 1.1K | 67.2K | 8.5K |
| sniper:all | claude-opus-4-6[1m] | 0 | 1.6min | $0.2231 | 683 | 4.0K | 93.0K | 12.3K |
| analyzer | claude-sonnet-4-6 | 28 | 3.3min | $0.4167 | 765 | 10.4K | 535.5K | 26.5K |
| triage | claude-opus-4-6[1m] | 19 | 2.5min | $0.5536 | 815 | 7.1K | 275.2K | 38.2K |

### samokatbot (19da0d39)

- scan_type: full, status: completed, depth: 100
- wall: 12.8min, agents: 4, errors: 0

| Agent | Primary model | Turns | Duration | Cost | Input | Output | Cache R | Cache C |
|---|---|---|---|---|---|---|---|---|
| scout-unclear:0 | claude-sonnet-4-6 | 0 | 34.7s | $0.0945 | 676 | 2.1K | 69.6K | 11.0K |
| sniper:all | claude-opus-4-6[1m] | 0 | 3.5min | $0.6507 | 955 | 12.0K | 115.0K | 46.7K |
| analyzer | claude-sonnet-4-6 | 49 | 4.4min | $0.7121 | 784 | 14.2K | 1.17M | 39.5K |
| triage | claude-opus-4-6[1m] | 34 | 4.2min | $1.1245 | 830 | 13.5K | 278.5K | 103.5K |

### rltrader (0de34b92)

- scan_type: full, status: completed, depth: 100
- wall: 31.6min, agents: 4, errors: 0

| Agent | Primary model | Turns | Duration | Cost | Input | Output | Cache R | Cache C |
|---|---|---|---|---|---|---|---|---|
| scout-unclear:0 | claude-sonnet-4-6 | 0 | 7.3min | $0.1165 | 679 | 3.2K | 71.9K | 12.5K |
| sniper:all | claude-opus-4-6[1m] | 0 | 3.1min | $1.5094 | 1.6K | 10.6K | 858.8K | 130.0K |
| analyzer | claude-sonnet-4-6 | 55 | 11.6min | $1.3907 | 2.2K | 37.2K | 1.74M | 81.6K |
| triage | claude-opus-4-6[1m] | 39 | 9.3min | $1.9618 | 843 | 35.5K | 949.3K | 95.8K |

### sigap-planner (c76f3713)

- scan_type: full, status: completed, depth: 100
- wall: 31.4min, agents: 7, errors: 0

| Agent | Primary model | Turns | Duration | Cost | Input | Output | Cache R | Cache C |
|---|---|---|---|---|---|---|---|---|
| scout-unclear:0 | claude-sonnet-4-6 | 0 | 2.4min | $0.3048 | 668 | 11.2K | 112.7K | 27.2K |
| sniper:root | claude-opus-4-6[1m] | 0 | 2.3min | $0.3855 | 735 | 6.4K | 59.1K | 31.2K |
| sniper:backend_migration | claude-opus-4-6[1m] | 0 | 3.4min | $1.0223 | 1.7K | 10.3K | 183.7K | 107.4K |
| sniper:backend_scripts | claude-opus-4-6[1m] | 0 | 4.0min | $1.6626 | 2.9K | 12.6K | 867.2K | 146.0K |
| sniper:mobile_macos_runner_configs | claude-opus-4-6[1m] | 0 | 3.1min | $2.8807 | 15.4K | 10.4K | 262.7K | 387.2K |
| analyzer | claude-sonnet-4-6 | 25 | 6.4min | $0.7511 | 2.6K | 25.0K | 1.12M | 108.0K |
| triage | claude-opus-4-6[1m] | 22 | 9.5min | $5.5944 | 881 | 55.9K | 4.29M | 328.4K |

### deimos (0f420879)

- scan_type: full, status: completed, depth: 100
- wall: 2.35h, agents: 24, errors: 0

| Agent | Primary model | Turns | Duration | Cost | Input | Output | Cache R | Cache C |
|---|---|---|---|---|---|---|---|---|
| scout-unclear:0 | claude-sonnet-4-6 | 0 | 1.7min | $0.2451 | 673 | 6.0K | 297.6K | 17.5K |
| scout-unclear:1 | claude-sonnet-4-6 | 0 | 1.2min | $0.2264 | 675 | 4.4K | 335.0K | 15.8K |
| scout-unclear:2 | claude-sonnet-4-6 | 0 | 11.4min | $1.6054 | 679 | 59.0K | 1.06M | 106.8K |
| sniper:dblogic_sec_part2 | claude-opus-4-6[1m] | 0 | 6.1min | $1.4390 | 2.1K | 16.7K | 697.9K | 107.3K |
| sniper:dblogic_sp_part1 | claude-opus-4-6[1m] | 0 | 4.3min | $1.7738 | 2.6K | 11.0K | 1.11M | 150.7K |
| sniper:dblogic_sp_part2 | claude-opus-4-6[1m] | 0 | 7.1min | $2.6146 | 2.6K | 19.5K | 1.78M | 197.9K |
| sniper:dblogic_sp_part3 | claude-opus-4-6[1m] | 0 | 6.2min | $2.4495 | 2.6K | 18.9K | 1.43M | 201.4K |
| sniper:dblogic_sp_part4 | claude-opus-4-6[1m] | 0 | 4.6min | $2.2167 | 2.1K | 14.9K | 1.36M | 186.1K |
| sniper:dblogic_sp_gg | claude-opus-4-6[1m] | 0 | 3.1min | $0.5171 | 975 | 9.7K | 97.9K | 36.1K |
| sniper:dblogic_scripts | claude-opus-4-6[1m] | 0 | 5.2min | $2.8262 | 1.9K | 15.9K | 494.0K | 348.9K |
| sniper:dblogic_scripts_foss | claude-opus-4-6[1m] | 0 | 3.6min | $0.7074 | 1.1K | 11.6K | 203.6K | 50.2K |
| sniper:dblogic_trg_part1 | claude-opus-4-6[1m] | 0 | 6.7min | $4.2125 | 3.1K | 22.7K | 340.9K | 555.4K |
| sniper:dblogic_trg_part2 | claude-opus-4-6[1m] | 0 | 5.7min | $2.1354 | 3.1K | 16.3K | 1.90M | 124.3K |
| sniper:dblogic_trg_part3 | claude-opus-4-6[1m] | 0 | 5.2min | $2.6170 | 3.1K | 14.2K | 2.51M | 161.3K |
| sniper:dblogic_trg_part4 | claude-opus-4-6[1m] | 0 | 5.6min | $3.9635 | 3.1K | 19.7K | 544.4K | 511.3K |
| sniper:dblogic_trg_part5 | claude-opus-4-6[1m] | 0 | 4.7min | $2.9107 | 2.7K | 16.6K | 426.4K | 365.0K |
| sniper:dblogic_type | claude-opus-4-6[1m] | 0 | 4.1min | $1.0567 | 1.1K | 11.9K | 323.6K | 95.5K |
| sniper:dblogic_view_part1 | claude-opus-4-6[1m] | 0 | 4.9min | $1.2814 | 2.3K | 12.6K | 458.7K | 117.8K |
| sniper:dblogic_view_part2 | claude-opus-4-6[1m] | 0 | 5.2min | $3.0151 | 2.4K | 18.3K | 378.9K | 378.6K |
| sniper:dblogic_view_part3 | claude-opus-4-6[1m] | 0 | 4.6min | $1.8993 | 1.8K | 15.7K | 332.1K | 214.2K |
| sniper:dblogic_job | claude-opus-4-6[1m] | 0 | 5.9min | $3.1342 | 3.0K | 18.5K | 2.28M | 244.9K |
| sniper:dblogic_sqlload | claude-opus-4-6[1m] | 0 | 3.9min | $1.2988 | 5.0K | 12.1K | 752.6K | 96.7K |
| analyzer | claude-sonnet-4-6 | 71 | 9.4min | $1.6454 | 812 | 28.8K | 2.93M | 89.2K |
| triage | claude-opus-4-6[1m] | 45 | 28.6min | $10.4971 | 1.1K | 113.0K | 8.43M | 552.8K |
