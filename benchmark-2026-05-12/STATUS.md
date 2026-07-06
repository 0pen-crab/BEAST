# Status of this folder (cleaned 2026-06)

This folder originally held a Trail of Bits **skills A/B benchmark** (skills vs no-skills).
That experiment has been **invalidated and the skills removed**. Reasons:

1. **The A/B was confounded.** The "with-skills" arm verified skill presence with
   `ls /root/.claude/skills/...`, but the scanner runs as user `scanner` — so Claude Code
   looked in `/home/scanner/.claude/skills/`, which was empty. The skills almost certainly
   **never loaded**, meaning both arms ran effectively identical configs. The measured
   "skill effect" is LLM run-to-run variance, not a real signal.
2. **The forensic re-audit independently concluded the bundle was net-negative** and
   recommended rolling it back. We did — the entire ToB skills bundle is gone from
   `claude-container/`. ToB value is retained only via the `p/trailofbits` **semgrep
   ruleset** in `security-tools/scripts/run-scans.sh`.

## What was deleted

All skills-measurement artifacts (`FINDINGS-FORENSIC.md`, `BENCHMARK-COMPARISON-2026-05-12.md`,
`HANDOFF.md`, all `raw-*`, `baseline-*`, `confirmation-reruns.json`, `scan-queue.json`) —
their only purpose was scoring the now-invalid A/B.

## What was kept (genuine, skills-independent engineering history)

- **`BUGS-AND-DECISIONS.md`** — real pipeline bugs found during the run (metrics aggregation,
  scanner resume re-running Claude calls, worker probe interval, multi-resume reporting
  undercount) plus the durable **methodology correction**: compare findings by
  fingerprint overlap (file+line+CWE+canonical-title), never by raw count — counts are
  gameable via finding-splitting and severity reclassification.
- **`DEIMOS-PIPELINE-REGRESSION.md`** — root-cause analysis showing the deimos slowdown was
  rate-limit exposure, not a pipeline regression; includes rate-limit scaling recommendations.

Note: these two files cross-reference the deleted reports; treat those references as historical.
