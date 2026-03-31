export interface ParsedFinding {
  title: string;
  severity: string;
  description: string;
  filePath: string;
  line: number | null;
  vulnIdFromTool: string;
  cwe: number | null;
  cvssScore: number | null;
}

// ── SARIF Parser (BEAST code-analysis + JFrog Xray) ────────────

function sarifLevelToSeverity(level: string | undefined): string {
  switch (level) {
    case 'error': return 'High';
    case 'warning': return 'Medium';
    case 'note': return 'Low';
    default: return 'Info';
  }
}

export function parseSarif(content: string): ParsedFinding[] {
  const findings: ParsedFinding[] = [];
  let sarif: { runs?: Array<{ results?: unknown[]; tool?: { driver?: { rules?: unknown[] } } }> };
  try {
    sarif = JSON.parse(content);
  } catch {
    return findings;
  }

  for (const run of sarif.runs ?? []) {
    const rules = new Map<string, Record<string, unknown>>();
    for (const rule of (run.tool?.driver?.rules ?? []) as Record<string, unknown>[]) {
      if (rule.id) rules.set(rule.id as string, rule);
    }

    for (const result of (run.results ?? []) as Record<string, unknown>[]) {
      const ruleId = (result.ruleId as string) || '';
      const rule = rules.get(ruleId) ?? {};
      const message = (result.message as { text?: string })?.text ?? '';
      const locations = (result.locations ?? []) as Array<{
        physicalLocation?: {
          artifactLocation?: { uri?: string };
          region?: { startLine?: number };
        };
      }>;
      const loc = locations[0]?.physicalLocation;
      const filePath = loc?.artifactLocation?.uri ?? '';
      const line = loc?.region?.startLine ?? null;

      // Severity: check properties.severity first, then level
      const props = (result.properties ?? {}) as Record<string, string>;
      let severity = props.severity || '';
      if (!severity) {
        severity = sarifLevelToSeverity(result.level as string);
      }

      // CWE from rule tags
      let cwe: number | null = null;
      const tags = (rule.properties as { tags?: string[] })?.tags ?? [];
      for (const tag of tags) {
        const match = tag.match(/^CWE-(\d+)$/i);
        if (match) { cwe = Number(match[1]); break; }
      }

      const ruleDesc = (rule.shortDescription as { text?: string })?.text
        ?? (rule.fullDescription as { text?: string })?.text
        ?? '';
      const description = message || ruleDesc;

      findings.push({
        title: ruleDesc || message || ruleId,
        severity,
        description,
        filePath,
        line,
        vulnIdFromTool: ruleId,
        cwe,
        cvssScore: null,
      });
    }
  }

  return findings;
}

// ── Gitleaks Parser ─────────────────────────────────────────────

export function parseGitleaks(content: string): ParsedFinding[] {
  const findings: ParsedFinding[] = [];
  let data: unknown[];
  try {
    data = JSON.parse(content);
    if (!Array.isArray(data)) return findings;
  } catch {
    return findings;
  }

  for (const entry of data as Record<string, unknown>[]) {
    findings.push({
      title: `Secret detected: ${entry.RuleID || entry.Description || 'unknown'}`,
      severity: 'High',
      description: (entry.Description as string) || `Gitleaks detected ${entry.RuleID}`,
      filePath: (entry.File as string) || '',
      line: (entry.StartLine as number) ?? null,
      vulnIdFromTool: (entry.RuleID as string) || '',
      cwe: 798,
      cvssScore: null,
    });
  }

  return findings;
}

// ── Trufflehog Parser ───────────────────────────────────────────

export function parseTrufflehog(content: string): ParsedFinding[] {
  const findings: ParsedFinding[] = [];
  const lines = content.split('\n').filter(l => l.trim());

  // Handle JSON array format (empty results)
  if (lines.length === 1 && lines[0].trim() === '[]') return findings;

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const detector = (entry.DetectorName as string) || 'unknown';
    const verified = !!entry.Verified;
    const meta = entry.SourceMetadata as { Data?: { Filesystem?: { file?: string; line?: number } } };
    const filePath = meta?.Data?.Filesystem?.file ?? '';
    const lineNum = meta?.Data?.Filesystem?.line ?? null;

    findings.push({
      title: `${verified ? 'Verified secret' : 'Potential secret'}: ${detector}`,
      severity: verified ? 'Critical' : 'High',
      description: `Trufflehog detected ${detector} credential${verified ? ' (VERIFIED - confirmed active)' : ' (unverified)'}`,
      filePath,
      line: lineNum,
      vulnIdFromTool: `trufflehog-${detector}`,
      cwe: 798,
      cvssScore: null,
    });
  }

  return findings;
}

// ── Trivy Parser ────────────────────────────────────────────────

function trivySeverityNormalize(sev: string): string {
  switch (sev?.toUpperCase()) {
    case 'CRITICAL': return 'Critical';
    case 'HIGH': return 'High';
    case 'MEDIUM': return 'Medium';
    case 'LOW': return 'Low';
    default: return 'Info';
  }
}

export function parseTrivy(content: string): ParsedFinding[] {
  const findings: ParsedFinding[] = [];
  let data: { Results?: unknown[] };
  try {
    data = JSON.parse(content);
  } catch {
    return findings;
  }

  for (const result of (data.Results ?? []) as Record<string, unknown>[]) {
    const target = (result.Target as string) || '';

    // Vulnerabilities
    for (const vuln of ((result.Vulnerabilities ?? []) as Record<string, unknown>[])) {
      findings.push({
        title: `${vuln.VulnerabilityID}: ${vuln.Title || vuln.PkgName}`,
        severity: trivySeverityNormalize(vuln.Severity as string),
        description: (vuln.Description as string) || `${vuln.VulnerabilityID} in ${vuln.PkgName}@${vuln.InstalledVersion}`,
        filePath: target,
        line: null,
        vulnIdFromTool: (vuln.VulnerabilityID as string) || '',
        cwe: null,
        cvssScore: (vuln.CVSS as { nvd?: { V3Score?: number } })?.nvd?.V3Score ?? null,
      });
    }

    // Secrets
    for (const secret of ((result.Secrets ?? []) as Record<string, unknown>[])) {
      findings.push({
        title: `Secret: ${secret.Title || secret.RuleID || 'unknown'}`,
        severity: trivySeverityNormalize(secret.Severity as string),
        description: (secret.Match as string) || (secret.Title as string) || '',
        filePath: target,
        line: (secret.StartLine as number) ?? null,
        vulnIdFromTool: (secret.RuleID as string) || '',
        cwe: 798,
        cvssScore: null,
      });
    }

    // Misconfigurations
    for (const misconf of ((result.Misconfigurations ?? []) as Record<string, unknown>[])) {
      findings.push({
        title: (misconf.Title as string) || (misconf.ID as string) || 'Misconfiguration',
        severity: trivySeverityNormalize(misconf.Severity as string),
        description: (misconf.Description as string) || (misconf.Message as string) || '',
        filePath: target,
        line: null,
        vulnIdFromTool: (misconf.ID as string) || '',
        cwe: null,
        cvssScore: null,
      });
    }
  }

  return findings;
}
