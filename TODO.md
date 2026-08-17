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

## Silent breakage batch (16-17 July deployment)

Uncovered during the first mass scan of 21 repositories. Five problems, four of which shared the same trait: the system silently did something different from what it reported. All fixes were applied to the working tree on 16-17 July but never committed; most are still present as unstaged changes a month later. Each item below must be reviewed, tested, and committed.

### FIX-01: apt cannot build security-tools image on arm64

**File:** `security-tools/Dockerfile`
**Status:** fix was applied but is now LOST (no diff against HEAD)

On arm64, apt fetches packages from `ports.ubuntu.com` (the only Canonical mirror for this architecture), and it does so over plain HTTP by default — apt relies on GPG signatures for integrity, so TLS is considered unnecessary. The problem: something on the network path (firewall, DPI, or ISP) throttles or blocks port-80 traffic to this specific host. Two of the four index repositories time out, apt prints a `W: Failed to fetch` warning (not an error), and continues with whatever partial index it managed to download. When it then tries to install curl, the dependency graph is incomplete and the build fails with "unmet dependencies". The person reading the log naturally blames the package list or the base image, because the real cause — a network-level block — happened 100 lines above and looked harmless.

The fix adds a shared `ubuntu-base` stage inherited by all three Ubuntu stages (downloader, python-builder, runtime). It switches apt sources to HTTPS, enables 3 retries, and — critically — sets `APT::Update::Error-Mode "any"`, which promotes any failed index fetch from a warning to an immediate build-breaking error. The first `apt-get update` runs with `Acquire::https::Verify-Peer=false` because the pristine `ubuntu:24.04` image has no root certificates yet — the very package we're installing (`ca-certificates`) is what provides them. All subsequent apt calls in downstream stages use full TLS verification.

This fix must be rewritten from scratch using the description above. Verify by building the image on arm64 — the `ubuntu-base` stage should complete in seconds, not the 90+ seconds it took before.

### FIX-02: archive upload drops plain folders when any .git folder exists

**File:** `api/src/routes/sources.ts` (upload endpoint, ~line 680)
**Status:** NOT FIXED (code still has the or/or branch)

When a user uploads a zip/tar containing 21 project folders, and 3 of them happen to contain a `.git` directory, the current code finds those 3 git repos and imports only them — silently discarding the other 18 folders. The logic is an either/or branch: if `gitRepoPaths.length > 0`, take only git repos; else fall through to the plain-folder branch. The UI says "3 repos found" with no indication that anything was dropped, which reads as "the archive contains 3 projects" rather than "I found 21 and threw away 18". This is a typical real-world scenario: some projects were cloned from git (and archived with `.git`), while others were just zipped from a local directory.

The fix must merge both types: collect git-repo paths from the recursive walk, then collect top-level directories that are NOT git repos and don't overlap with any found git repo (neither a parent nor a child of a git path). Combine both lists. The overlap check prevents double-importing: if `/extracted/projectA` contains `.git`, it should appear once as a git repo, not twice (once as git, once as a plain dir). If nothing is found at all, fall back to treating the entire archive as one repo.

Three unit tests are needed: (a) mixed archive with git + plain folders imports all; (b) archive with only git repos works as before; (c) archive with only plain folders works as before. This corresponds to existing TODO item #16.

### FIX-03: empty catch in clone step hides ENOENT, killing all uploaded-repo scans

**File:** `api/src/orchestrator/steps/clone.ts` (~line 36)
**Status:** FIXED in working tree, needs review and commit

For repos uploaded as archives, `cloneRepo()` runs in local-path mode — it verifies the path exists and returns immediately without creating any directories. The next line calls `chownSync(ctx.repoBaseDir, ...)` on a directory that doesn't exist yet, throws ENOENT, and the `catch {}` block swallows it without a trace. Later, `ensureScanDir` creates child directories (toolsDir, agentDir) recursively, which incidentally creates repoBaseDir too — but owned by root. The `scanner` user on claude-runner can't write into a root-owned directory, so the analyzer fails to write `scan-context.md`, and the pipeline correctly refuses to continue. All 21 scans fail with "Analyzer did not write scan context" — a symptom three steps removed from the cause.

The fix in the working tree adds `fs.mkdirSync(ctx.repoBaseDir, { recursive: true })` before the chown call, and replaces the silent catch with `chownToScanner()` — a helper that throws a loud error naming the exact path and the permission failure. The old `ensureScanDir` also gets the same treatment. Four regression tests cover: mkdir-before-chown ordering for local-path repos, workDir chown, and two tests that verify EPERM/ENOENT throw instead of being swallowed.

Review the existing diff, confirm the logic, and commit. Additionally, consider whether the remaining `catch` blocks elsewhere in clone.ts need the same treatment.

### FIX-04: Windows archives carry directories without execute bit — scanners skip a third of the code

**File:** `api/src/routes/sources.ts` (upload endpoint, after tar extraction ~line 653)
**Status:** NOT FIXED (no chmod in the code)

This is the most dangerous of the five because it produces a scan that looks completely normal. Archives created on Windows often store directories with Unix permissions that lack the execute bit for group and others (e.g. `drwxr--r--`). On Unix, the `x` bit on a directory means "can traverse into it" — without it, `ls`, `find`, and every scanning tool simply skip that subtree. After extracting the archive as root, the permissions are faithfully reproduced. The `scanner` user on security-tools then can't enter those directories, and each tool silently omits them from its scan. In the `kernel` repo, 331 of 879 directories were inaccessible — more than a third of the codebase was invisible to every scanner, yet the scan completed successfully with plausible-looking findings.

The fix is one line after tar extraction: `execFileSync('chmod', ['-R', 'u+rwX,go+rX', extractDir])`. The capital `X` is critical — it sets the execute bit only on directories and on files that already had it, so source files don't become executable (which itself would be a scanner finding). This should go right after the tar/unzip call at ~line 653, before `findGitRepos`.

A unit test should create a tar with a directory whose permissions lack the `x` bit, run the upload logic, and verify the directory is traversable afterward. This is more important than a chmod-exists assertion — it tests the actual permission outcome.

### FIX-05: osv-scanner exit code 128 on C++ repos is not a failure

**File:** `security-tools/scripts/run-scans.sh` (~line 306)
**Status:** FIXED in working tree, needs review and commit

`osv-scanner` looks for dependency manifests (package-lock.json, go.sum, requirements.txt, etc.) and exits with code 128 when it finds none — "No package sources found". For pure C++/CMake projects this is the correct and expected outcome: there are no dependency manifests to scan. But `run_tool` treats any non-zero exit as a tool failure, the scan gets marked "completed with errors", and over time people learn to ignore that status — which means they'll also ignore it when the error is real.

The fix in the working tree wraps the osv-scanner call in a `run_tool_osv` function that captures the exit code and stderr. If the exit code is non-zero and the output contains "No package sources found", it records an empty SARIF result with status "success" and returns 0. The log gets an explicit line explaining the situation so "success" isn't silent. This was confirmed working on the `bastion-agent` C++ repo.

Review the existing diff and commit. Additionally, this is a point fix for one tool — the document notes that other tools have their own "nothing to scan" exit codes. A follow-up task should audit all 8 tools and handle their empty-result codes inside `run_tool` itself, rather than adding a per-tool if-block after each call.

### FIX-06: E2E login helper doesn't handle onboarding redirect

**File:** `e2e/helpers.ts` (login function, line 3-9)
**Status:** not fixed, no code changes

The `login()` helper navigates to `/login`, fills credentials, clicks sign in, and calls `waitForURL('/')`. On a fresh database — which is what you get after a clean deployment or a DB reset — the first login redirects to `/onboarding` instead of `/`. The helper's `waitForURL('/')` never matches, the test times out, and the entire E2E suite fails before running a single test. This isn't an edge case: every CI run against a clean environment hits it.

The onboarding wizard is multi-step: Workspace → AI Analysis → Tools → Source → Import. Only the first step (workspace name + create) is required; the rest can be skipped. The `ensureLoggedIn()` helper relies on detecting the sidebar, which doesn't exist on the onboarding page. The smoke test (`e2e/smoke.spec.ts:25-45`) detects `/setup` but not `/onboarding`.

The fix: after clicking sign in, the helper should check whether it landed on `/onboarding`. If so, fill a workspace name (e.g. "E2E Test"), click "Create workspace", then skip the remaining steps to reach the dashboard. Also: after `npm install`, Playwright requires `npx playwright install chromium` — there is no postinstall hook for this.

### FIX-07: scan resume pulls stale failed-tool results from checkpoint

**File:** `api/src/orchestrator/pipeline.ts` (~line 289-345)
**Status:** not fixed, no code changes

When a scan gets paused (rate limit) or interrupted and the worker resumes it, the pipeline loads existing `scan_steps` rows. Any step marked `completed` is skipped entirely — its stored output is loaded into the accumulated state and the step never re-runs. The problem: the security-tools step marks itself `completed` even when individual tools inside it failed (those failures are recorded as `toolErrors` in its output). On resume, the pipeline sees "completed", loads the old output with its broken tool results, and commits them as the final scan data. The scan "finishes" with known-bad results.

This is a step-level abstraction issue. The Sniper module system (scanner.ts:538) correctly distinguishes completed vs failed modules and retries failed ones. But the pipeline step for security-tools has no concept of "completed with partial failures worth retrying" — it's all-or-nothing at the step level. The security-tools step runs all 8 tools in a single SSH call to `run-scans.sh`, so there's no granularity to retry individual tools.

Two possible fixes: (a) the security-tools step should mark itself `failed` (not `completed`) when any tool failed, so the pipeline re-runs the entire step on resume; or (b) add selective retry support — on resume, detect which tools failed from the stored output, pass them as a filter to `run-scans.sh` (it already supports `--tools`), and merge the new results with the old ones. Option (a) is simpler but re-runs tools that already succeeded.

### FIX-08: expired GitLab token spams worker logs, drowning real errors

**File:** `api/src/orchestrator/sync-worker.ts` (line 12-61)
**Status:** not fixed, no code changes

The sync worker runs `checkSyncs()` every 5 minutes, querying all sources whose `lastSyncedAt + syncIntervalMinutes` is in the past. For each due source, it calls `syncSource()` which creates a provider client and fetches the repo list. When a token is expired, the API call fails, the error is logged to console, `lastSyncedAt` is updated to now (creating a backoff of one interval), and a `sync_failed` workspace event is created. But the source stays fully active — next cycle, it retries and fails again, forever. With the default 1440-minute (24h) interval this means one error per day, but it still clutters the logs and events feed. The specific case: an expired GitLab token for `education-git.yadro.com` has been spamming errors since the deployment.

There is no mechanism in the codebase to disable or pause a source after repeated failures. The `sources` table has no `syncFailCount`, `enabled`, or `syncPaused` column.

The fix: add a `syncFailCount` integer column (default 0) to sources. On sync success, reset to 0. On failure, increment; if it exceeds a threshold (e.g. 3 consecutive failures), stop syncing that source and emit a `sync_paused` event with a clear message. The source card in the UI should show a "paused" badge with a "Resume" button that resets the counter. A simpler alternative: exponential backoff on the interval (double it each failure, cap at 7 days) without a pause flag — but this gives no UI visibility.
