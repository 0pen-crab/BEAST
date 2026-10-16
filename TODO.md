# TODO

- [x] Add AI settings to the workspace creation wizard (scan depth, various toggles, everything currently in Settings).
- [x] ~~Add skills from trialofbits to the AI pipeline.~~ *(Reverted 2026-06 — ToB skills never actually loaded by the scanner user; removed entirely. Trail of Bits value retained via the `p/trailofbits` semgrep ruleset in `security-tools/scripts/run-scans.sh`.)*
- [ ] Add SSO (Azure, etc)
- [x] Calculate an exploitability score for each finding. *(merged with #8 — see Verify Findings)*
- [x] Repository profile — rearrange block layout, edit. *(2026-07 — split analyzer output into agent-only `scan-context.md` (Summary, Module Map, Security Context, Trust Boundaries, Complexity Hotspots; consumed by scanner+triage, fail-loud if missing) and a human `repo-profile.md` (Summary, Project Structure, merged Contributors, Code Quality table, DevOps, Risk Summary incl. problematic deps). Security Context + Trust Boundaries now surface human-readably in the Security Audit report. Removed duplicate profile scan_file.)*
- [ ] Integrate Jira for creating tickets in bulk.
- [ ] Add integration with Teams/Slack/Element.
- [x] ~~!!!!!! Triage — provide a link to the product and have Claude verify whether the vulnerabilities reproduce.~~ *(Built as the "Verify Findings" 4-wave pipeline, then REMOVED entirely 2026-07 — feature not needed for now. Deleted: verify-* prompts, verification/ modules, VERIFICATION_MODELS, pipeline dispatch, scans.ts verification body, verification-report endpoint, dashboard components/hooks/tab/button, i18n keys, and the scans.verification_settings / findings.exploitability_score columns (schema + orphan migration 0004). If revisited: rebuild from scratch.)*
- [x] Analyzer is eating up too much context. *(2026-07 — upgraded the `sonnet` model mapping to `claude-sonnet-5[1m]`: 1M context window (was 200k on Sonnet 4.6), ~2× cheaper introductory pricing, stronger agentic performance. Applies everywhere `sonnet` is used (analyzer, triage report wave, feedback, verification wave1). Opus left at 4.6 per decision. Verified end-to-end on a live scan.)*
- [x] Add ability to export all findings for repo.
- [ ] (Future) Bitbucket PR-webhook feature — build from scratch. The original March scaffolding (webhook handler, pull_requests table, PR scan kickoff, PR comment-back, hook register/remove client methods) NEVER ran (0 PRs, 0 PR scans ever) and was removed entirely in 2026-06 to keep the codebase honest. When/if revisited, design it end-to-end and: (a) match the target repo on the unique repo ID Bitbucket sends, NOT by name (same-named repos across teams would otherwise attach to the wrong repo); (b) re-add the `/api/webhooks/*` auth bypass, the `pull_requests` table, `scans.pull_request_id`, and the sources webhook-registration flow.
- [x] ~~Finish the "Verify Findings" frontend.~~ *(Moot — the whole Verify Findings feature was removed 2026-07 (see above).)*
- [x] Bitbucket connection: a network/TLS error is shown to the user as "Invalid token", which is misleading. Distinguish a bad token from a network/certificate failure and show an honest message for each. *(validateToken now returns a reason: invalid_token / forbidden / not_found / network / http_error; sources route maps each to an honest message — network → 502 "couldn't reach Bitbucket, token may be fine", bad token → 400 "invalid token".)*
- [ ] When we run claude-login, it should start with the old terminal type, NOT fullscreen.
- [ ] **Let the user say how an uploaded archive is laid out.** When an archive's root holds only folders (say `src/`, `docs/`, `tests/`) and no loose file, BEAST can't tell one project from a bundle of several, and imports each folder as its own repository. Add a single / multiple / auto-detect choice to the upload form and store it on the source, instead of adding another guess to `repo-discovery.ts`.
- [ ] **Give E2E tests their own database.** Playwright runs against the same database as local development, so tests that create things leave them behind — every run of the notes test adds a permanent note to a real finding, and notes cannot be deleted (they are an audit trail). Start the app for E2E on a throwaway database seeded with known data, which also lets the tests stop skipping when a workspace happens to be empty.

## Frontend cleanup

- [ ] **Type-check the dashboard.** `vite build` does not run tsc, so about 25 type errors have piled up unnoticed — unused variables, wrong `.ts` import extensions, `pathOptions` on graph edges in `pipeline-test.tsx` and `toolkit-pipeline.tsx`. One of them was a real crash (an undefined setter in the source form's rate-limit retry). Fix them, then add the dashboard to the tsc step in `./test.sh` so new ones fail the run.
- [ ] **Remove the local `EmptyState` copy in `scans.tsx`.** It duplicates the shared empty-state component; use the shared one.
- [ ] **Replace Tailwind utility classes with toolkit classes.** `topbar.tsx` is built almost entirely from utilities, the contributors team filter uses `w-auto`, and ignored repo rows use `opacity-60`. Add the missing classes to the toolkit and use them instead.
- [ ] **Translate the remaining hardcoded English.** The section titles on the contributor profile and "Back to workspace" in the admin layout bypass i18n, and so do the tool category names on the dashboard (Code Analysis, Dependencies, Infrastructure, Secrets, Personal Data come straight from `lib/tool-mapping.ts`).
- [ ] **Drop `REPO_STATUSES` or use it.** It is only referenced by its own test.

## Scan quality, speed and storage

### Which tools are worth running

- [ ] **Find out who marks findings as false positive or duplicate.** We judge each tool by how much of its output ends up marked false positive or duplicate. That only measures the tool if a person made those calls — if the AI triage step sets most of them, we are measuring triage instead. Count, per status, how many came from triage and how many from people, and only then trust the per-tool noise numbers.
- [ ] **Measure how much the three dependency scanners overlap.** osv-scanner, JFrog Xray and Trivy all report vulnerable packages, and many of their findings are the same CVE on the same package. For every package + CVE, count whether all three found it, two, or one, and which tool most often finds something nobody else does. Decide which to keep and what coverage dropping each one would cost.
- [ ] **Same for the four secret scanners.** gitleaks, GitGuardian, TruffleHog and Trivy's secret scanner overlap heavily, and nothing Trivy's secret scanner reported has ever stayed open. Confirm it adds nothing before removing it. Separately, gitleaks has the most false positives of the four — check whether they come from a few rules or file types that can be excluded.
- [ ] **Cut semgrep's false positives.** Semgrep is the largest single source of false positives and never reports anything Critical or High. Group its false positives by rule and ruleset, exclude the worst rules, and check whether its findings marked "risk accepted" are real decisions or triage giving up.
- [ ] **Fix severity mapping across tools.** Some tools map every finding to Critical/High (checkov, gitleaks, GitGuardian, TruffleHog) while semgrep and osv-scanner map none. Compare what each tool actually emits with how `parsers.ts` normalises it, and correct the mapping.

### Where scan time goes

- [ ] **Record how long each security tool takes.** `run-scans.sh` already measures every tool's duration, but BEAST throws it away unless the tool fails, so "which tool is slow" cannot be answered. Store the duration for every tool run (the `tests` table has no column for it) and show it in the UI. Needed before deciding which overlapping tools to drop.
- [ ] **Find why the AI research step is slow on some repos.** It takes the biggest share of scan time — usually around ten minutes, but hours on a few repos. Find what those repos have in common (size, file count, number of modules, rate-limit pauses) using the stored AI traces, and propose a cap or a time budget.
- [ ] **Find what the triage-and-report step spends its time on.** It is the second biggest share of scan time. Check whether its time grows with the number of findings or is a fixed cost per scan, and cut the fixed part if it dominates.
- [ ] **Stop gitleaks from re-reading large files in history.** Scanning full history can take minutes where the working tree takes seconds, because gitleaks re-reads every old version of big data files. `--max-target-megabytes=1` fixes most of it; the structural fix is to remember the last scanned commit per repo and scan only new commits.
- [ ] **Make cloning faster and more reliable.** Clone is the step that fails most often, and every scan does a full clone. Measure how often we re-clone a repo that is already on disk, and decide on shallow clones together with the gitleaks history question above — the two depend on each other.

### Reliability

- [ ] **Find out why scans fail.** The main causes are SSH commands timing out with no output, Claude Code not being logged in on the runner (which should be caught before a scan starts), and clones failing on network errors. For the timeouts, find which step and tool hang and whether the 60-minute inactivity timeout is still being hit.
- [ ] **Investigate the "possible scanner regression" errors from mitigation check.** When a finding disappears from a scan, mitigation check reads the code; if the bug is still there, it logs an error saying the scanners missed it. These are most of the errors on the Events page. Find out whether the scanners really miss these (a tool failed, or the AI just did not report it this time) or mitigation check is wrong, and lower the level only for cases that are expected — so real errors are not buried.
- [ ] **Make the Events page something people actually work through.** No event has ever been marked resolved. Once the noise above is gone, review which real errors remain and whether the resolve flow is usable.
- [ ] **Check that "completed with errors" is set when it should be.** Scans whose security-tools or analysis step failed often finish without the flag. Find where it gets lost and add a test that would have caught it.

### Database size

- [ ] **Add retention for scan step payloads.** Every pipeline step's full input and output is stored forever, and `scan_steps` is by far the biggest table. Work out what resume and debugging actually need, and trim or expire the rest.
- [ ] **Move AI trace logs out of Postgres or expire them.** Raw AI agent traces and logs make up most of `scan_files`. Decide whether they belong in the database at all, and set a retention window or move them to files.
