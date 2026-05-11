---
name: bst-test
description: Run pre-release tests, fix failures in a loop, then verify every RELEASE.md feature in Chrome browser. Use before cutting a release to ensure everything works.
user-invocable: true
---

# Pre-Release Test & Verification Skill

You are running the full pre-release verification workflow. This has TWO phases: automated tests and manual browser verification.

## Phase 0: Verify Chrome access

**This is a hard gate — do NOT proceed without Chrome.**

Before doing anything else, verify you have access to Chrome browser automation by calling `mcp__claude-in-chrome__tabs_context_mcp`.

- If the call succeeds → proceed to Phase 1.
- If the call fails or returns an error → **STOP IMMEDIATELY** and tell the user:
  "Chrome browser access is not available. Please connect the Claude-in-Chrome extension and try again."
  Do NOT continue with any other steps.

## Phase 1: Automated tests (fix loop)

Run the pre-release test suite:
```bash
cd /home/shrimp/Documents/projects/BEAST && ./pre-release.sh
```

### If all tests pass
Print a summary and proceed to Phase 2.

### If tests fail
1. Read the failure output carefully. Identify the root cause of each failing spec.
2. Fix the issue in the source code (implementation, NOT the test — unless the test itself is wrong).
3. If you changed API code, rebuild the containers:
   ```bash
   cd /home/shrimp/Documents/projects/BEAST && docker compose build api worker && docker compose up -d api worker
   ```
   If you changed dashboard code:
   ```bash
   cd /home/shrimp/Documents/projects/BEAST && docker compose build dashboard && docker compose up -d dashboard
   ```
   Wait a few seconds for containers to stabilize.
4. Re-run ONLY the failing spec(s) first to confirm the fix:
   ```bash
   cd /home/shrimp/Documents/projects/BEAST/e2e && npx playwright test <failing-spec>
   ```
5. Once individual specs pass, re-run the full suite:
   ```bash
   cd /home/shrimp/Documents/projects/BEAST && ./pre-release.sh
   ```
6. Repeat this loop until ALL specs pass. Do not give up — keep diagnosing and fixing.

**Rules for the fix loop:**
- Fix the code, not the tests (unless the test expectation is genuinely wrong).
- Do NOT stop mid-loop to ask the user. Complete the full fix-and-rerun cycle first. Only ask the user for guidance at the very end if you've exhausted all ideas and the suite still fails.
- Always rebuild relevant containers after code changes.

## Phase 2: Browser verification of RELEASE.md features

Once all automated tests pass, verify features in the browser.

### Step 1: Read RELEASE.md
Read `RELEASE.md` from the project root. If it doesn't exist, tell the user there are no release notes to verify and finish.

### Step 2: Parse features to verify
Extract every bullet point from RELEASE.md. Each one is a feature/improvement/fix that needs manual verification in the browser.

### Step 3: Open the app
Navigate to `http://localhost:8000` in Chrome. Log in with credentials `admin` / `admin1`.

### Step 4: Verify each feature
For EACH item in RELEASE.md:

1. **Announce** what you're about to verify: "Verifying: <feature description>"
2. **Navigate** to the relevant page in the browser UI
3. **Interact** with the feature exactly as a real user would — click buttons, fill forms, navigate between pages, check that data displays correctly
4. **Verify** the expected outcome is visible and correct
5. **Report** the result:
   - PASS — feature works as described
   - FAIL — describe what's wrong

**Verification rules:**
- Use the browser like a real user. Click through the UI, don't curl endpoints.
- If a feature involves creating/editing something, actually do it in the browser.
- If a feature is about visual changes (layout, styling, new UI elements), take a screenshot and confirm it looks right.
- If a feature involves data display, verify the data is correct and complete.
- If verifying a feature would break the app state for subsequent checks (e.g., deleting something critical), skip the destructive action but verify the UI elements are present and functional.

### Step 5: Summary
After checking all features, print a summary:

```
Pre-Release Verification Summary
================================
Automated tests: ALL PASSED
Browser verification:
  ✓ <feature 1> — PASS
  ✓ <feature 2> — PASS
  ✗ <feature 3> — FAIL: <reason>

Result: READY TO SHIP / BLOCKED (N issues found)
```

If any browser verifications failed:
1. Attempt to fix the issues
2. Rebuild containers if needed
3. Re-verify the failed items
4. Update the summary

Only report "READY TO SHIP" when ALL automated tests pass AND ALL browser verifications pass.
