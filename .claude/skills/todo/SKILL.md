---
name: todo
description: Append a TODO entry to TODO.md in the project root. Use when the user runs /todo "text" to capture a quick task.
user-invocable: true
---

# TODO Skill

Append a single TODO entry to `TODO.md` in the project root.

## Step 1: Extract the text

The user invokes the skill as `/todo "text here"` (or `/todo text here`). Take everything after the command as the entry text. Strip surrounding quotes if present. Trim whitespace.

If the text is empty, ask the user what to add and stop.

## Step 2: Translate to English

The user may write the entry in any language. Translate it to clear, natural English before saving — TODO.md is always written in English regardless of input language.

Rules for translation:
- Preserve the meaning and intent exactly — do not add scope, rephrase as a "better" task, or expand abbreviations the user didn't expand.
- Keep technical terms, file paths, identifiers, code snippets, URLs, and proper nouns as-is.
- If the input is already in English, use it verbatim (no rewriting).
- Keep it concise — match the length and tone of the original.

## Step 3: Read existing TODO.md

Check if `TODO.md` exists at the project root (`/home/shrimp/Documents/projects/BEAST/TODO.md`).
- If it exists, read it — you will append, not overwrite.
- If it does not exist, you will create it with a `# TODO` header.

## Step 4: Append the entry

Add the translated entry as a markdown checklist item at the end of the file:

```markdown
- [ ] <english entry text>
```

Rules:
- One entry per invocation — do not split the text into multiple items.
- Do not modify or reorder existing entries.
- Do not add timestamps, author tags, or extra formatting unless the user explicitly asks for it.
- Do not paraphrase or "improve" beyond the language translation itself.
- If the file is new, write:
  ```markdown
  # TODO

  - [ ] <english entry text>
  ```

## Step 5: Confirm

Reply with one short sentence in the same language the user used in their prompt, showing the English text that was saved. Do not show the entire file.
