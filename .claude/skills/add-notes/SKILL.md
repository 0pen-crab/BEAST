---
name: add-notes
description: Append user-facing changes from the current conversation to RELEASE.md. Use when the user wants to document what changed.
user-invocable: true
---

# Add Release Notes Skill

Append user-facing changes from the current conversation to `RELEASE.md` in the project root.

## Step 1: Review the conversation

Scan the current conversation for all features added, improvements made, and bugs fixed. Focus on user-facing outcomes, not implementation details.

## Step 2: Read existing notes

If `RELEASE.md` already exists, read it — you will append to it, not overwrite.

## Step 3: Write notes

Add new entries to `RELEASE.md` using this format:

```markdown
## What's new
- <entry>

## ✨ Improvements
- <entry>

## 🔧 Fixes
- <entry>
```

Rules:
- If `RELEASE.md` already exists, merge new entries into existing categories. Do not duplicate entries that are already there.
- Skip empty categories entirely.
- Each entry is one short sentence describing the user-facing outcome — no file paths, no function names, no technical jargon.
- The test: "Did this capability exist before?" No → What's new. Yes but better → Improvement. Was broken → Fix.
- Purely internal changes (refactoring, test coverage, config tweaks) — do NOT include.

## Step 4: Confirm

Show the user the final contents of `RELEASE.md` and confirm it looks good.
