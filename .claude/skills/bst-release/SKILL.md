---
name: bst-release
description: Run the full release workflow — bump version, generate release notes, commit, tag, and push. Use when the user wants to cut a new release.
user-invocable: true
---

# Release Skill

You are running a release workflow. Guide the user step-by-step.

## Step 1: Determine current version

Find the latest git tag matching `v*` pattern:
```bash
git tag --list 'v*' --sort=-version:refname | head -1
```

If no tags exist, the current version is `v0.0.0`.

Show the current version to the user.

## Step 2: Ask release type

Use the `AskUserQuestion` tool to present a selection UI:

Question: "What type of release is this?" (header: "Release type")
Options:
- label: "minor", description: "New features, non-breaking improvements (e.g. v1.0.0 → v1.1.0)"
- label: "fix", description: "Bug fixes, small patches (e.g. v1.0.0 → v1.0.1)"
- label: "major", description: "Breaking changes, major new functionality (e.g. v1.0.0 → v2.0.0)"

Wait for the user's choice before proceeding.

## Step 3: Calculate new version

Parse the current version and bump accordingly:
- major: increment first number, reset others to 0
- minor: increment second number, reset third to 0
- fix: increment third number

Show the new version and ask for confirmation.

## Step 4: Gather changes

Collect changes from FOUR sources:

### Source A: Release notes draft (HIGH PRIORITY if exists)
Check if `RELEASE.md` exists in the project root. If it does, read it — this is a running draft maintained via the `/bst-note` skill with pre-written user-facing descriptions. Use these entries as-is (they're already in the correct style). Merge with other sources to ensure nothing is missed.

### Source B: Full diff since previous tag (PRIMARY — most important)
This is the single source of truth for what actually changed. Run:
```bash
git diff <previous-tag>..HEAD --stat
```
Then read the full diff for ALL changed files:
```bash
git diff <previous-tag>..HEAD
```
This catches EVERYTHING — both committed and already-merged changes. Do NOT rely on `git log` alone, because there may be only one or two squashed commits covering many features.

### Source C: Uncommitted changes
Check for work-in-progress that should also be included:
```bash
git diff --stat
git diff --stat --cached
```
Read the full diff if there are uncommitted changes.

### Source D: Current conversation context
Review the conversation history from this session. Extract context about WHY changes were made — this helps write better descriptions.

Combine all four sources. Source A (draft) has the best descriptions if it exists. Source B is the authority on WHAT changed. Source D provides context for writing good descriptions.

## Step 5: Generate and show release notes

Create well-structured release notes in GitHub-flavored markdown. Exactly THREE categories:

```markdown
## What's new
- Brand new capabilities that didn't exist before

## ✨ Improvements
- Enhancements to existing functionality that already existed

## 🔧 Fixes
- Bugs that were resolved
```

### Category rules
- **"What's new"** — genuinely NEW features. Something that didn't exist at all before this release. If the user couldn't do X before and now they can — it's "What's new".
- **"Improvements"** — existing features that now work BETTER. The feature already existed, but now it's faster, smarter, more convenient, supports more formats, etc.
- **"Fixes"** — only actual bugs that were broken before and now work correctly.
- A change belongs to exactly ONE category. The test: "Did this capability exist before?" Yes → Improvement. No → What's new. Was it broken → Fix.
- Skip empty categories entirely.
- Related items that describe aspects of a single feature should be MERGED into one bullet point, not listed separately.

### Writing style rules — CRITICAL

Release notes are for USERS, not developers. Each line must answer: "what can I do now that I couldn't before?" or "what works better now?".

**GOOD examples:**
- "Workspace-scoped data isolation — each workspace sees only its own teams, repos, and findings"
- "Bitbucket PR scanning with automatic comment posting"
- "Ukrainian language support in dashboard"

**BAD examples (NEVER write like this):**
- "Scan events — Per-scan event tracking with dedicated API endpoints" — meaningless, what does the user get?
- "Drizzle ORM migration — Schema moved from raw SQL to Drizzle pgTable definitions" — implementation detail, user doesn't care
- "Internal API token for secure container-to-container communication" — invisible to user
- "Claude status check timeout increased to 45s" — invisible to user

Rules:
- Write in English
- One short sentence per item — no file paths, no function names, no technical jargon
- Describe the outcome, not the implementation
- Skip empty categories entirely
- Do NOT include commit hashes, file paths, or code references
- If a change is purely internal (refactoring, migration, test coverage, timeouts, internal tokens) — do NOT include it
- Each distinct feature/change = exactly ONE bullet point in ONE category, never duplicated
- Do NOT include new API endpoints unless they are user-facing

Show the release notes in a markdown code block so the user can copy-paste and edit them.

## Step 6: Ask to proceed

After showing the notes, use `AskUserQuestion`:

Question: "Proceed with commit and tag v<new-version>?" (header: "Release")
Options:
- label: "Yes", description: "Commit all changes and create the tag"
- label: "Cancel", description: "Abort the release"

If "Cancel" — stop immediately.
Do NOT offer an "Edit" option — the user will edit the notes themselves and re-run the skill if needed.

## Step 7: Commit, tag, push, and create PR

Only after the user says "Yes":

1. Update version in `dashboard/package.json` to the new version number (e.g. `"version": "0.2.0"`). This is the single source of truth for the app version displayed in the UI.

2. Stage and commit all changes (if any uncommitted):
```bash
git add -A
git commit -m "Release v<new-version>"
```

3. Delete `RELEASE.md` if it exists:
```bash
rm -f RELEASE.md
```

4. Create an annotated git tag:
```bash
git tag -a v<new-version> -m "Release v<new-version>"
```

5. Force push the current branch to remote:
```bash
git push --force origin <current-branch>
```

Show the PR URL so the user can merge immediately.

## Important

- NEVER iterate on release notes editing — just output them once and ask to proceed
- If any step fails, show the error and ask how to proceed
