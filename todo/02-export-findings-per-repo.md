# Plan: Export Findings Per Repository

**TODO item:** "Add ability to export all findings for repo"
**Status:** Planned, not implemented

---

## Goal

Replicate the existing **workspace-level "highlights" export** (AI-curated CSV of most-critical findings) but scoped to a **single repository**.

User on a Repo page hits "Generate findings brief" → Claude analyzes only THIS repo's findings → curated CSV download.

---

## What already exists (workspace level)

- `POST /api/highlights/generate?workspace_id=X` — fetches all open findings for workspace, sends CSV to Claude, returns `jobId`
- `GET /api/highlights/:id` — poll status (processing/done/failed)
- `GET /api/highlights/:id/download` — download curated CSV
- `GET /api/highlights/latest?workspace_id=X` — get most recent job for workspace (for UI state restoration)
- In-memory `jobs` map (1h TTL via `pruneJobs()`)
- Dashboard button at `dashboard/src/pages/dashboard.tsx:124`
- Job key: `workspace_id` only

---

## Implementation

### Approach

**Extend existing endpoint with optional `repository_id`** rather than duplicating routes. Same job mechanism, same Claude prompt structure, same CSV format — just one extra filter and slightly enriched prompt context.

### Files & changes

#### 1. `api/src/routes/highlights.ts`

- Extend `HighlightsJob` interface:
  ```ts
  interface HighlightsJob {
    id: string;
    workspaceId: number;
    repositoryId?: number;  // NEW — undefined = workspace-wide
    status: ...;
    ...
  }
  ```

- `POST /highlights/generate`: add optional `repository_id` to query schema; if present, add `eq(findings.repositoryId, repository_id)` to WHERE clause. Save on job.

- `GET /highlights/latest`: add optional `repository_id` query param. When provided, return latest job where `repositoryId === query.repository_id`. When omitted, return latest where `repositoryId === undefined` (workspace-wide only).

- `runHighlightsAnalysis()`: accept `repoName?: string`. If provided, inject into prompt:
  ```
  These findings come from repository "X". Focus your curation on the most
  exploitable, business-critical issues for this codebase.
  ```

- Download endpoint: filename includes repo name if scoped:
  - workspace: `security-brief-2026-05-12.csv`
  - repo: `security-brief-{repo-name-slug}-2026-05-12.csv`

#### 2. `api/src/routes/highlights.test.ts`

- Add test: `POST /highlights/generate?workspace_id=1&repository_id=42` returns 200 with `jobId`
- Add test: SQL query includes repository filter when param provided
- Add test: `GET /highlights/latest?workspace_id=1&repository_id=42` returns only repo-scoped jobs
- Add test: download filename includes repo name slug

#### 3. `dashboard/src/api/hooks.ts`

- Add `useRepoHighlightsJob(workspaceId, repositoryId)` hook (or extend existing one with optional repoId)
- API functions:
  - `generateRepoHighlights(workspaceId, repositoryId)`
  - `getRepoHighlightsLatest(workspaceId, repositoryId)`
  - `getRepoHighlightsStatus(jobId, workspaceId)` — same endpoint as workspace
  - `downloadRepoHighlights(jobId, workspaceId)` — same endpoint as workspace

#### 4. `dashboard/src/pages/repo.tsx`

- Add a button on Repo header (or in a sidebar action area):
  - "AI-Curated Brief" or similar
  - Triggers `generateRepoHighlights`
  - Same UX as Dashboard button: polling, progress indicator, download link when ready
- Reuse component logic from `dashboard.tsx` (consider extracting `<HighlightsButton>` component to `dashboard/src/components/highlights-button.tsx` if duplication is significant)

#### 5. Translations

- `dashboard/src/locales/en.json`: add keys for new button + states
  - `repo.exportFindings`, `repo.exportFindingsRunning`, `repo.exportFindingsReady`, `repo.exportFindingsDownload`
- `dashboard/src/locales/uk.json`: same in Ukrainian

#### 6. E2E

- Optional: extend smoke test or add a separate `e2e/highlights-repo.spec.ts` that:
  1. Login
  2. Navigate to a repo with findings
  3. Click export button
  4. Poll until done
  5. Verify download triggers (CSV header present)

Skip if smoke is already covering enough of this; the unit tests + manual verification is fine.

---

## Out of scope

- Changing existing workspace-level highlights flow (keep backward compat)
- New job storage (Redis, DB) — current in-memory map with 1h TTL stays as-is
- Format other than CSV (no PDF/JSON export — that's a separate TODO if user asks)
- "Raw" export (no AI curation) — also a separate TODO, this one is specifically about the AI-curated brief

---

## Why this is easy

- Same Claude prompt template (only `repoName` added)
- Same job tracking mechanism
- Same download endpoint
- Only schema change is `repository_id` filter on findings query
- UI work is mostly "copy the button placement pattern from dashboard.tsx"

---

## Success criteria

- Generate button on Repo page works end-to-end
- Curated CSV contains ONLY findings from that repo (no workspace bleed-through)
- Filename includes repo name slug
- Job tracking doesn't conflict with workspace-level highlights (e.g., generating both simultaneously works independently)
- All highlights.test.ts tests pass (existing + new ones)

---

## Open questions for implementation time

- **Job collision rule:** if user has both workspace highlights and repo highlights running, are they truly independent jobs? Yes — different `jobId`s, but `pruneJobs()` works regardless. ✅
- **What's the minimum findings count before button is enabled?** Workspace flow shows `no_findings` error when 0. Same logic for repo. Probably also disable button in UI if `findingsCount === 0` for visual clarity.
- **Permissions:** workspace-scoped authorize already handles this — user must be `member` of workspace. Repo is always within a workspace, so same check applies.
