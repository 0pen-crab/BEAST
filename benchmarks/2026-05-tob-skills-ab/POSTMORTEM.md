# Postmortem — the experiment measured noise (2026-06)

Read this before `REPORT.md`. The report's conclusion ("the ToB skills bundle is net
negative") was the honest reading of the data in May. A month later we found that the
data could not support any conclusion about skills at all.

## What went wrong

**The skills never loaded.** The "with-skills" arm verified skill presence with
`ls /root/.claude/skills/...`, but the scanner runs as user `scanner`, so Claude Code
looked in `/home/scanner/.claude/skills/`, which was empty. The only real difference
between the arms was a few lines in `analyzer.md` and `scanner.md` telling the agent to
use skills that were not installed.

So every difference between the arms in `REPORT.md` and `FINDINGS-FORENSIC.md` — the
lost Highs on cosmetic_bot and samokatbot, the coverage shuffle on rltrader, the
"+7 Highs, 0 new" on sigap-planner — is **run-to-run LLM variance plus whatever those
dangling prompt lines did**. The two cannot be separated, and neither is a skill effect.

## What we did about it

- Rolled back the whole bundle — `claude-container/` no longer ships ToB skills. Trail of
  Bits value is kept through the `p/trailofbits` semgrep ruleset in
  `security-tools/scripts/run-scans.sh`, which is deterministic and verifiably runs.
- Made it a rule of the methodology (`../README.md`, step 2): **verify the treatment reached the process under
  test**, as the user it runs as — not by inspecting the image from a different user.

## Why the data is still here

The skill verdict is void, but the runs are not worthless. They are the best measurement
we have of how much BEAST's AI output moves between two identical runs — and that turned
out to be large enough to fake a convincing regression. That is the reason the
methodology in `../README.md` insists on fingerprint/semantic matching, per-finding
forensic review and reproducibility re-runs instead of finding counts.

The engineering findings are unaffected by the confound and stand on their own:

- `PIPELINE-BUGS-AND-DECISIONS.md` — real pipeline bugs found during the runs (metrics
  aggregation, scanner resume re-running Claude calls, worker probe interval,
  multi-resume reporting undercount).
- `DEIMOS-PIPELINE-REGRESSION.md` — the deimos slowdown was rate-limit exposure
  (1 pause vs 9), not a pipeline regression.

The raw artifacts were deleted from the working tree in June and recovered in October
from a June 2 stash.
