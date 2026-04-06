<h1 align="center">BEAST</h1>
<p align="center">
  <img src="docs/beast.png" alt="BEAST" width="400" />
</p>
<h3 align="center"><code>BE</code>TTER &nbsp;&nbsp;&nbsp;<code>A</code>PPLICATION &nbsp;&nbsp;&nbsp;<code>S</code>ECURITY &nbsp;&nbsp;&nbsp;<code>T</code>ESTING</h3>
<p align="center">2026-04-01</p>

<p align="left">
Run security scans across your entire codebase — regardless of where the code lives. Connect GitHub, GitLab, or Bitbucket organizations, paste a repo URL, upload a zip, or mount a local folder. BEAST combines AI-powered analysis (Claude Code) with industry-standard security tools to find vulnerabilities, secrets, misconfigurations, and dependency risks — then triages findings and generates actionable reports.
</p>

<p align="left">
- <b>14 security tools</b> &middot; Semgrep, Snyk, Gitleaks, Trufflehog, Trivy, Checkov, OSV-Scanner, GitGuardian, JFrog Xray & more<br/>
- <b>Repository profile</b> &middot; AI builds a complete profile of each repo — stack, architecture, contributors, risk areas<br/>
- <b>Security audit</b> &middot; AI reads the code, cross-references tool findings, and produces a consolidated audit report<br/>
- <b>Contributor profiles</b> &middot; AI assesses each contributor — commit patterns, risk areas, code ownership<br/>
- <b>AI triage</b> &middot; Claude Code analyzes code context, reduces noise, and prioritizes real threats<br/>
- <b>Multi-workspace</b> &middot; Isolate teams, orgs, or clients with full data separation<br/>
- <b>Any VCS</b> &middot; GitHub, GitLab, Bitbucket Cloud, direct URLs, zip uploads, local paths<br/>
- <b>Self-hosted</b> &middot; Single <code>make install</code>, everything runs in Docker
</p>

## Getting Started

**Prerequisites:** Docker, Docker Compose

```bash
# 1. Install (would take a while, be patient)
make install

# 2. Authenticate Claude Code scanner
make auth

# 3. Open dashboard
open http://localhost:8000
```

First user to register becomes admin.

## Ports

| Service        | Port |
|----------------|------|
| Dashboard      | 8000 |
| API            | 3000 |
| PostgreSQL     | 5432 |
| claude-runner  | 2222 (SSH) |
| security-tools | 2223 (SSH) |