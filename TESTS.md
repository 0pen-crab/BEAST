# BEAST Smoke Test Procedure

This document describes the end-to-end smoke test that validates core BEAST functionality. This test must be run after every major design or backend change.

## Prerequisites

- App running at `http://localhost:8000` via `docker compose up -d`
- No existing admin account (fresh instance) or admin/admin1 credentials available
- Internet access (for GitHub source import)

## Smoke Test Flow

### 1. Admin Account Creation
- Navigate to `http://localhost:8000`
- Should redirect to `/setup` page
- Create admin account with username `admin`, password `admin1`
- Should redirect to admin console or dashboard

### 2. Workspace Creation
- Navigate to Admin Console → Workspaces
- Click "Create Workspace"
- Enter workspace name: "Smoke Test"
- Click "Create"
- Click "View" on the created workspace
- Should navigate to the main dashboard with the workspace selected

### 3. Source Configuration
- Navigate to Settings page
- Scroll to Sources section
- Click "Add source"
- Select "Public" tab
- Enter URL: `https://github.com/vitfury`
- Click "Add"
- When repo list appears, click "Import all"
- Should import all repositories from the GitHub profile

### 4. Security Tools Configuration
- On Settings page, scroll to Security Tools section
- Enable all free/open-source tools that don't require tokens:
  - **Secret Scanning**: Gitleaks, Trufflehog, Trivy
  - **SAST**: Semgrep
  - **SCA**: OSV-Scanner, Trivy
  - **IaC**: Checkov, Trivy
- Skip tools requiring credentials: GitGuardian, Snyk, JFrog Xray

### 5. Run Scan
- Navigate to Scans page
- Click "New Scan"
- Enter Repository URL: `https://github.com/vitfury/simple-worker-api.git`
- Click "Start Scan"
- Should see "Scan queued successfully"
- Wait for scan to complete (check Queue/Completed/Failed tabs)
- Scan should reach "Completed" status (AI steps may be skipped if Claude Code not authenticated)

### 6. Verify Results
- Navigate to Repos page
- Click on `simple-worker-api` repository
- Should see scan results, findings, and tool cards
- Navigate to Findings page
- Should see any detected findings listed
- Navigate to Dashboard
- Should see updated severity distribution and tool summary

## Automated Test

The smoke test is automated as a Playwright E2E test in `e2e/smoke.spec.ts`. Run it with:

```bash
cd e2e && npx playwright test smoke.spec.ts
```

## Test Credentials

| Field    | Value  |
|----------|--------|
| Username | admin  |
| Password | admin1 |
