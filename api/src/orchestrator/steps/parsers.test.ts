import { describe, it, expect } from 'vitest';
import { parseSarif, parseGitleaks, parseTrufflehog, parseTrivy } from './parsers.ts';

// ── parseSarif ─────────────────────────────────────────────────────

describe('parseSarif', () => {
  it('parses a valid SARIF result with all fields', () => {
    const sarif = {
      runs: [
        {
          tool: {
            driver: {
              rules: [
                {
                  id: 'RULE-001',
                  shortDescription: { text: 'SQL Injection' },
                  fullDescription: { text: 'Full desc of SQL Injection' },
                  properties: { tags: ['CWE-89'] },
                },
              ],
            },
          },
          results: [
            {
              ruleId: 'RULE-001',
              level: 'error',
              message: { text: 'Found SQL injection vulnerability' },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: 'src/db.ts' },
                    region: { startLine: 42 },
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      title: 'SQL Injection',
      severity: 'High',
      description: 'Found SQL injection vulnerability',
      filePath: 'src/db.ts',
      line: 42,
      vulnIdFromTool: 'RULE-001',
      cwe: 89,
      cvssScore: null,
    });
  });

  it('maps level "error" to severity "High"', () => {
    const sarif = {
      runs: [{ results: [{ ruleId: 'R1', level: 'error', message: { text: 'msg' } }] }],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].severity).toBe('High');
  });

  it('maps level "warning" to severity "Medium"', () => {
    const sarif = {
      runs: [{ results: [{ ruleId: 'R1', level: 'warning', message: { text: 'msg' } }] }],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].severity).toBe('Medium');
  });

  it('maps level "note" to severity "Low"', () => {
    const sarif = {
      runs: [{ results: [{ ruleId: 'R1', level: 'note', message: { text: 'msg' } }] }],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].severity).toBe('Low');
  });

  it('maps unknown/missing level to severity "Info"', () => {
    const sarif = {
      runs: [{ results: [{ ruleId: 'R1', message: { text: 'msg' } }] }],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].severity).toBe('Info');
  });

  it('maps unrecognized level to severity "Info"', () => {
    const sarif = {
      runs: [{ results: [{ ruleId: 'R1', level: 'other', message: { text: 'msg' } }] }],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].severity).toBe('Info');
  });

  it('prefers properties.severity over level', () => {
    const sarif = {
      runs: [
        {
          results: [
            {
              ruleId: 'R1',
              level: 'error',
              message: { text: 'msg' },
              properties: { severity: 'Critical' },
            },
          ],
        },
      ],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].severity).toBe('Critical');
  });

  it('falls back to level when properties.severity is empty string', () => {
    const sarif = {
      runs: [
        {
          results: [
            {
              ruleId: 'R1',
              level: 'warning',
              message: { text: 'msg' },
              properties: { severity: '' },
            },
          ],
        },
      ],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].severity).toBe('Medium');
  });

  it('extracts CWE from rule tags (case-insensitive)', () => {
    const sarif = {
      runs: [
        {
          tool: {
            driver: {
              rules: [
                {
                  id: 'R1',
                  shortDescription: { text: 'desc' },
                  properties: { tags: ['security', 'CWE-79', 'external'] },
                },
              ],
            },
          },
          results: [{ ruleId: 'R1', level: 'error', message: { text: 'msg' } }],
        },
      ],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].cwe).toBe(79);
  });

  it('extracts only the first CWE when multiple tags match', () => {
    const sarif = {
      runs: [
        {
          tool: {
            driver: {
              rules: [
                {
                  id: 'R1',
                  shortDescription: { text: 'desc' },
                  properties: { tags: ['CWE-79', 'CWE-89'] },
                },
              ],
            },
          },
          results: [{ ruleId: 'R1', level: 'error', message: { text: 'msg' } }],
        },
      ],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].cwe).toBe(79);
  });

  it('sets cwe to null when no CWE tags present', () => {
    const sarif = {
      runs: [
        {
          tool: {
            driver: {
              rules: [
                {
                  id: 'R1',
                  shortDescription: { text: 'desc' },
                  properties: { tags: ['security', 'quality'] },
                },
              ],
            },
          },
          results: [{ ruleId: 'R1', level: 'error', message: { text: 'msg' } }],
        },
      ],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].cwe).toBeNull();
  });

  it('does not match partial CWE tags like "CWE-79-extra"', () => {
    const sarif = {
      runs: [
        {
          tool: {
            driver: {
              rules: [
                {
                  id: 'R1',
                  shortDescription: { text: 'desc' },
                  properties: { tags: ['CWE-79-extra'] },
                },
              ],
            },
          },
          results: [{ ruleId: 'R1', level: 'error', message: { text: 'msg' } }],
        },
      ],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].cwe).toBeNull();
  });

  it('uses shortDescription as title, falling back to message, then ruleId', () => {
    // With shortDescription
    const sarifWithShort = {
      runs: [
        {
          tool: { driver: { rules: [{ id: 'R1', shortDescription: { text: 'Short' } }] } },
          results: [{ ruleId: 'R1', message: { text: 'Msg' } }],
        },
      ],
    };
    expect(parseSarif(JSON.stringify(sarifWithShort))[0].title).toBe('Short');

    // Without shortDescription, with fullDescription
    const sarifWithFull = {
      runs: [
        {
          tool: { driver: { rules: [{ id: 'R1', fullDescription: { text: 'Full' } }] } },
          results: [{ ruleId: 'R1', message: { text: 'Msg' } }],
        },
      ],
    };
    expect(parseSarif(JSON.stringify(sarifWithFull))[0].title).toBe('Full');

    // Without any rule description, falls back to message
    const sarifMsgOnly = {
      runs: [{ results: [{ ruleId: 'R1', message: { text: 'Msg' } }] }],
    };
    expect(parseSarif(JSON.stringify(sarifMsgOnly))[0].title).toBe('Msg');

    // Without message text either, falls back to ruleId
    const sarifRuleIdOnly = {
      runs: [{ results: [{ ruleId: 'R1', message: {} }] }],
    };
    expect(parseSarif(JSON.stringify(sarifRuleIdOnly))[0].title).toBe('R1');
  });

  it('uses message as description, falling back to ruleDesc', () => {
    // message present -> use message
    const sarifMsg = {
      runs: [
        {
          tool: { driver: { rules: [{ id: 'R1', shortDescription: { text: 'Short' } }] } },
          results: [{ ruleId: 'R1', message: { text: 'The message' } }],
        },
      ],
    };
    expect(parseSarif(JSON.stringify(sarifMsg))[0].description).toBe('The message');

    // no message -> use ruleDesc
    const sarifNoMsg = {
      runs: [
        {
          tool: { driver: { rules: [{ id: 'R1', shortDescription: { text: 'Short' } }] } },
          results: [{ ruleId: 'R1', message: {} }],
        },
      ],
    };
    expect(parseSarif(JSON.stringify(sarifNoMsg))[0].description).toBe('Short');
  });

  it('handles missing locations gracefully', () => {
    const sarif = {
      runs: [{ results: [{ ruleId: 'R1', level: 'error', message: { text: 'msg' } }] }],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].filePath).toBe('');
    expect(findings[0].line).toBeNull();
  });

  it('handles empty locations array', () => {
    const sarif = {
      runs: [
        {
          results: [
            { ruleId: 'R1', level: 'error', message: { text: 'msg' }, locations: [] },
          ],
        },
      ],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].filePath).toBe('');
    expect(findings[0].line).toBeNull();
  });

  it('handles multiple runs with multiple results', () => {
    const sarif = {
      runs: [
        { results: [{ ruleId: 'R1', message: { text: 'a' } }] },
        {
          results: [
            { ruleId: 'R2', message: { text: 'b' } },
            { ruleId: 'R3', message: { text: 'c' } },
          ],
        },
      ],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings).toHaveLength(3);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseSarif('not json')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseSarif('')).toEqual([]);
  });

  it('returns empty array when runs is missing', () => {
    expect(parseSarif(JSON.stringify({}))).toEqual([]);
  });

  it('returns empty array when runs is empty', () => {
    expect(parseSarif(JSON.stringify({ runs: [] }))).toEqual([]);
  });

  it('returns empty array when results is empty', () => {
    expect(parseSarif(JSON.stringify({ runs: [{ results: [] }] }))).toEqual([]);
  });

  it('handles result with no ruleId', () => {
    const sarif = {
      runs: [{ results: [{ message: { text: 'msg' }, level: 'error' }] }],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].vulnIdFromTool).toBe('');
    expect(findings[0].title).toBe('msg');
  });

  it('handles rule with no properties/tags', () => {
    const sarif = {
      runs: [
        {
          tool: { driver: { rules: [{ id: 'R1', shortDescription: { text: 'desc' } }] } },
          results: [{ ruleId: 'R1', message: { text: 'msg' } }],
        },
      ],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].cwe).toBeNull();
  });

  it('always sets cvssScore to null', () => {
    const sarif = {
      runs: [{ results: [{ ruleId: 'R1', message: { text: 'msg' } }] }],
    };
    const findings = parseSarif(JSON.stringify(sarif));
    expect(findings[0].cvssScore).toBeNull();
  });
});

// ── parseGitleaks ──────────────────────────────────────────────────

describe('parseGitleaks', () => {
  it('parses a valid entry with all fields', () => {
    const data = [
      {
        RuleID: 'aws-access-key',
        Description: 'AWS Access Key',
        File: 'config/.env',
        StartLine: 10,
      },
    ];
    const findings = parseGitleaks(JSON.stringify(data));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      title: 'Secret detected: aws-access-key',
      severity: 'High',
      description: 'AWS Access Key',
      filePath: 'config/.env',
      line: 10,
      vulnIdFromTool: 'aws-access-key',
      cwe: 798,
      cvssScore: null,
    });
  });

  it('constructs title preferring RuleID over Description', () => {
    const data = [{ RuleID: 'my-rule', Description: 'My Description' }];
    const findings = parseGitleaks(JSON.stringify(data));
    expect(findings[0].title).toBe('Secret detected: my-rule');
  });

  it('falls back title to Description when RuleID is missing', () => {
    const data = [{ Description: 'My Description' }];
    const findings = parseGitleaks(JSON.stringify(data));
    expect(findings[0].title).toBe('Secret detected: My Description');
  });

  it('falls back title to "unknown" when both RuleID and Description are missing', () => {
    const data = [{}];
    const findings = parseGitleaks(JSON.stringify(data));
    expect(findings[0].title).toBe('Secret detected: unknown');
  });

  it('uses Description as description text', () => {
    const data = [{ RuleID: 'r1', Description: 'Desc text' }];
    const findings = parseGitleaks(JSON.stringify(data));
    expect(findings[0].description).toBe('Desc text');
  });

  it('falls back description to "Gitleaks detected {RuleID}" when Description missing', () => {
    const data = [{ RuleID: 'my-rule' }];
    const findings = parseGitleaks(JSON.stringify(data));
    expect(findings[0].description).toBe('Gitleaks detected my-rule');
  });

  it('defaults filePath to empty string when File is missing', () => {
    const data = [{ RuleID: 'r1' }];
    const findings = parseGitleaks(JSON.stringify(data));
    expect(findings[0].filePath).toBe('');
  });

  it('defaults line to null when StartLine is missing', () => {
    const data = [{ RuleID: 'r1' }];
    const findings = parseGitleaks(JSON.stringify(data));
    expect(findings[0].line).toBeNull();
  });

  it('defaults vulnIdFromTool to empty string when RuleID is missing', () => {
    const data = [{ Description: 'desc' }];
    const findings = parseGitleaks(JSON.stringify(data));
    expect(findings[0].vulnIdFromTool).toBe('');
  });

  it('always sets severity to High', () => {
    const data = [{ RuleID: 'r1' }, { RuleID: 'r2' }];
    const findings = parseGitleaks(JSON.stringify(data));
    findings.forEach(f => expect(f.severity).toBe('High'));
  });

  it('always sets cwe to 798', () => {
    const data = [{ RuleID: 'r1' }];
    const findings = parseGitleaks(JSON.stringify(data));
    expect(findings[0].cwe).toBe(798);
  });

  it('always sets cvssScore to null', () => {
    const data = [{ RuleID: 'r1' }];
    const findings = parseGitleaks(JSON.stringify(data));
    expect(findings[0].cvssScore).toBeNull();
  });

  it('parses multiple entries', () => {
    const data = [
      { RuleID: 'r1', File: 'a.txt', StartLine: 1 },
      { RuleID: 'r2', File: 'b.txt', StartLine: 2 },
      { RuleID: 'r3', File: 'c.txt', StartLine: 3 },
    ];
    const findings = parseGitleaks(JSON.stringify(data));
    expect(findings).toHaveLength(3);
    expect(findings[0].vulnIdFromTool).toBe('r1');
    expect(findings[1].vulnIdFromTool).toBe('r2');
    expect(findings[2].vulnIdFromTool).toBe('r3');
  });

  it('returns empty array for empty array input', () => {
    expect(parseGitleaks('[]')).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseGitleaks('not json at all')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseGitleaks('')).toEqual([]);
  });

  it('returns empty array for non-array JSON (object)', () => {
    expect(parseGitleaks('{"key": "value"}')).toEqual([]);
  });

  it('returns empty array for non-array JSON (string)', () => {
    expect(parseGitleaks('"hello"')).toEqual([]);
  });

  it('returns empty array for non-array JSON (number)', () => {
    expect(parseGitleaks('42')).toEqual([]);
  });
});

// ── parseTrufflehog ────────────────────────────────────────────────

describe('parseTrufflehog', () => {
  it('parses a verified secret with full SourceMetadata', () => {
    const entry = {
      DetectorName: 'AWS',
      Verified: true,
      SourceMetadata: {
        Data: {
          Filesystem: { file: 'creds.yaml', line: 5 },
        },
      },
    };
    const findings = parseTrufflehog(JSON.stringify(entry));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      title: 'Verified secret: AWS',
      severity: 'Critical',
      description: 'Trufflehog detected AWS credential (VERIFIED - confirmed active)',
      filePath: 'creds.yaml',
      line: 5,
      vulnIdFromTool: 'trufflehog-AWS',
      cwe: 798,
      cvssScore: null,
    });
  });

  it('parses an unverified secret', () => {
    const entry = {
      DetectorName: 'GitHub',
      Verified: false,
      SourceMetadata: {
        Data: { Filesystem: { file: 'token.txt', line: 1 } },
      },
    };
    const findings = parseTrufflehog(JSON.stringify(entry));
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('Potential secret: GitHub');
    expect(findings[0].severity).toBe('High');
    expect(findings[0].description).toContain('(unverified)');
  });

  it('treats missing Verified field as unverified', () => {
    const entry = { DetectorName: 'Slack' };
    const findings = parseTrufflehog(JSON.stringify(entry));
    expect(findings[0].severity).toBe('High');
    expect(findings[0].title).toBe('Potential secret: Slack');
  });

  it('handles missing SourceMetadata gracefully', () => {
    const entry = { DetectorName: 'GenericKey', Verified: true };
    const findings = parseTrufflehog(JSON.stringify(entry));
    expect(findings[0].filePath).toBe('');
    expect(findings[0].line).toBeNull();
  });

  it('handles missing Filesystem inside SourceMetadata', () => {
    const entry = {
      DetectorName: 'Key',
      SourceMetadata: { Data: {} },
    };
    const findings = parseTrufflehog(JSON.stringify(entry));
    expect(findings[0].filePath).toBe('');
    expect(findings[0].line).toBeNull();
  });

  it('defaults DetectorName to "unknown"', () => {
    const entry = {};
    const findings = parseTrufflehog(JSON.stringify(entry));
    expect(findings[0].title).toBe('Potential secret: unknown');
    expect(findings[0].vulnIdFromTool).toBe('trufflehog-unknown');
    expect(findings[0].description).toContain('unknown credential');
  });

  it('always sets cwe to 798', () => {
    const entry = { DetectorName: 'X' };
    const findings = parseTrufflehog(JSON.stringify(entry));
    expect(findings[0].cwe).toBe(798);
  });

  it('always sets cvssScore to null', () => {
    const entry = { DetectorName: 'X' };
    const findings = parseTrufflehog(JSON.stringify(entry));
    expect(findings[0].cvssScore).toBeNull();
  });

  it('parses NDJSON (multiple lines)', () => {
    const line1 = JSON.stringify({ DetectorName: 'AWS', Verified: true });
    const line2 = JSON.stringify({ DetectorName: 'GitHub', Verified: false });
    const content = `${line1}\n${line2}`;
    const findings = parseTrufflehog(content);
    expect(findings).toHaveLength(2);
    expect(findings[0].title).toBe('Verified secret: AWS');
    expect(findings[1].title).toBe('Potential secret: GitHub');
  });

  it('skips invalid lines in NDJSON and continues parsing', () => {
    const validLine = JSON.stringify({ DetectorName: 'AWS', Verified: false });
    const content = `not valid json\n${validLine}\nalso bad`;
    const findings = parseTrufflehog(content);
    expect(findings).toHaveLength(1);
    expect(findings[0].vulnIdFromTool).toBe('trufflehog-AWS');
  });

  it('returns empty array for empty string', () => {
    expect(parseTrufflehog('')).toEqual([]);
  });

  it('returns empty array for "[]" (empty array format)', () => {
    expect(parseTrufflehog('[]')).toEqual([]);
  });

  it('skips blank lines', () => {
    const line1 = JSON.stringify({ DetectorName: 'A' });
    const content = `\n\n${line1}\n\n`;
    const findings = parseTrufflehog(content);
    expect(findings).toHaveLength(1);
  });

  it('returns empty array for only whitespace', () => {
    expect(parseTrufflehog('   \n  \n   ')).toEqual([]);
  });
});

// ── parseTrivy ─────────────────────────────────────────────────────

describe('parseTrivy', () => {
  // -- Severity normalization --

  it('normalizes "CRITICAL" to "Critical"', () => {
    const data = {
      Results: [
        {
          Target: 'pkg.json',
          Vulnerabilities: [
            { VulnerabilityID: 'CVE-1', Severity: 'CRITICAL', PkgName: 'pkg' },
          ],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].severity).toBe('Critical');
  });

  it('normalizes "HIGH" to "High"', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Vulnerabilities: [{ VulnerabilityID: 'CVE-1', Severity: 'HIGH', PkgName: 'p' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].severity).toBe('High');
  });

  it('normalizes "MEDIUM" to "Medium"', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Vulnerabilities: [{ VulnerabilityID: 'CVE-1', Severity: 'MEDIUM', PkgName: 'p' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].severity).toBe('Medium');
  });

  it('normalizes "LOW" to "Low"', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Vulnerabilities: [{ VulnerabilityID: 'CVE-1', Severity: 'LOW', PkgName: 'p' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].severity).toBe('Low');
  });

  it('normalizes unknown severity to "Info"', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Vulnerabilities: [{ VulnerabilityID: 'CVE-1', Severity: 'UNKNOWN', PkgName: 'p' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].severity).toBe('Info');
  });

  it('normalizes case-insensitive severity (e.g. "high")', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Vulnerabilities: [{ VulnerabilityID: 'CVE-1', Severity: 'high', PkgName: 'p' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].severity).toBe('High');
  });

  // -- Vulnerabilities --

  it('parses vulnerabilities with all fields', () => {
    const data = {
      Results: [
        {
          Target: 'package-lock.json',
          Vulnerabilities: [
            {
              VulnerabilityID: 'CVE-2023-1234',
              Title: 'Buffer Overflow',
              Severity: 'HIGH',
              Description: 'A buffer overflow in libfoo',
              PkgName: 'libfoo',
              InstalledVersion: '1.0.0',
              CVSS: { nvd: { V3Score: 9.8 } },
            },
          ],
        },
      ],
    };
    const findings = parseTrivy(JSON.stringify(data));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      title: 'CVE-2023-1234: Buffer Overflow',
      severity: 'High',
      description: 'A buffer overflow in libfoo',
      filePath: 'package-lock.json',
      line: null,
      vulnIdFromTool: 'CVE-2023-1234',
      cwe: null,
      cvssScore: 9.8,
    });
  });

  it('falls back title to PkgName when Title is missing', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Vulnerabilities: [
            { VulnerabilityID: 'CVE-1', PkgName: 'lodash', Severity: 'MEDIUM' },
          ],
        },
      ],
    };
    const findings = parseTrivy(JSON.stringify(data));
    expect(findings[0].title).toBe('CVE-1: lodash');
  });

  it('falls back description to VulnerabilityID in PkgName@Version format', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Vulnerabilities: [
            {
              VulnerabilityID: 'CVE-99',
              PkgName: 'express',
              InstalledVersion: '4.17.0',
              Severity: 'LOW',
            },
          ],
        },
      ],
    };
    const findings = parseTrivy(JSON.stringify(data));
    expect(findings[0].description).toBe('CVE-99 in express@4.17.0');
  });

  it('sets cvssScore to null when CVSS is missing', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Vulnerabilities: [
            { VulnerabilityID: 'CVE-1', PkgName: 'p', Severity: 'LOW' },
          ],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].cvssScore).toBeNull();
  });

  it('sets cvssScore to null when CVSS.nvd is missing', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Vulnerabilities: [
            { VulnerabilityID: 'CVE-1', PkgName: 'p', Severity: 'LOW', CVSS: {} },
          ],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].cvssScore).toBeNull();
  });

  it('vulnerability line is always null', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Vulnerabilities: [{ VulnerabilityID: 'CVE-1', PkgName: 'p', Severity: 'HIGH' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].line).toBeNull();
  });

  it('vulnerability cwe is always null', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Vulnerabilities: [{ VulnerabilityID: 'CVE-1', PkgName: 'p', Severity: 'HIGH' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].cwe).toBeNull();
  });

  // -- Secrets --

  it('parses secrets with CWE 798', () => {
    const data = {
      Results: [
        {
          Target: 'app/.env',
          Secrets: [
            {
              Title: 'AWS Access Key',
              RuleID: 'aws-access-key-id',
              Severity: 'CRITICAL',
              Match: 'AKIA***',
              StartLine: 3,
            },
          ],
        },
      ],
    };
    const findings = parseTrivy(JSON.stringify(data));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      title: 'Secret: AWS Access Key',
      severity: 'Critical',
      description: 'AKIA***',
      filePath: 'app/.env',
      line: 3,
      vulnIdFromTool: 'aws-access-key-id',
      cwe: 798,
      cvssScore: null,
    });
  });

  it('secret title falls back to RuleID when Title is missing', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Secrets: [{ RuleID: 'generic-secret', Severity: 'HIGH' }],
        },
      ],
    };
    const findings = parseTrivy(JSON.stringify(data));
    expect(findings[0].title).toBe('Secret: generic-secret');
  });

  it('secret title falls back to "unknown" when both Title and RuleID are missing', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Secrets: [{ Severity: 'HIGH' }],
        },
      ],
    };
    const findings = parseTrivy(JSON.stringify(data));
    expect(findings[0].title).toBe('Secret: unknown');
  });

  it('secret description falls back to Title when Match is missing', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Secrets: [{ Title: 'GitHub Token', Severity: 'HIGH' }],
        },
      ],
    };
    const findings = parseTrivy(JSON.stringify(data));
    expect(findings[0].description).toBe('GitHub Token');
  });

  it('secret description is empty string when both Match and Title are missing', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Secrets: [{ RuleID: 'r1', Severity: 'HIGH' }],
        },
      ],
    };
    const findings = parseTrivy(JSON.stringify(data));
    expect(findings[0].description).toBe('');
  });

  it('secret line defaults to null when StartLine missing', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Secrets: [{ RuleID: 'r1', Severity: 'HIGH' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].line).toBeNull();
  });

  // -- Misconfigurations --

  it('parses misconfigurations', () => {
    const data = {
      Results: [
        {
          Target: 'Dockerfile',
          Misconfigurations: [
            {
              ID: 'DS001',
              Title: 'Root user in Dockerfile',
              Severity: 'MEDIUM',
              Description: 'Running as root is insecure',
            },
          ],
        },
      ],
    };
    const findings = parseTrivy(JSON.stringify(data));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      title: 'Root user in Dockerfile',
      severity: 'Medium',
      description: 'Running as root is insecure',
      filePath: 'Dockerfile',
      line: null,
      vulnIdFromTool: 'DS001',
      cwe: null,
      cvssScore: null,
    });
  });

  it('misconfiguration title falls back to ID', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Misconfigurations: [{ ID: 'DS002', Severity: 'LOW', Message: 'msg' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].title).toBe('DS002');
  });

  it('misconfiguration title falls back to "Misconfiguration" when both Title and ID are missing', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Misconfigurations: [{ Severity: 'LOW' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].title).toBe('Misconfiguration');
  });

  it('misconfiguration description falls back to Message', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Misconfigurations: [{ ID: 'DS1', Severity: 'LOW', Message: 'The msg' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].description).toBe('The msg');
  });

  it('misconfiguration description is empty when both Description and Message missing', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Misconfigurations: [{ ID: 'DS1', Severity: 'LOW' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].description).toBe('');
  });

  it('misconfiguration line is always null', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Misconfigurations: [{ ID: 'DS1', Severity: 'HIGH' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].line).toBeNull();
  });

  it('misconfiguration cwe is always null', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Misconfigurations: [{ ID: 'DS1', Severity: 'HIGH' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].cwe).toBeNull();
  });

  it('misconfiguration cvssScore is always null', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Misconfigurations: [{ ID: 'DS1', Severity: 'HIGH' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].cvssScore).toBeNull();
  });

  // -- Mixed results --

  it('parses mixed result types (vulnerabilities, secrets, misconfigurations) in one Result', () => {
    const data = {
      Results: [
        {
          Target: 'mixed-target',
          Vulnerabilities: [
            { VulnerabilityID: 'CVE-1', PkgName: 'pkg1', Severity: 'HIGH', Title: 'Vuln1' },
          ],
          Secrets: [
            { Title: 'Secret1', RuleID: 'secret-1', Severity: 'CRITICAL', Match: 'match' },
          ],
          Misconfigurations: [
            { ID: 'MC-1', Title: 'Misconf1', Severity: 'MEDIUM', Description: 'desc' },
          ],
        },
      ],
    };
    const findings = parseTrivy(JSON.stringify(data));
    expect(findings).toHaveLength(3);
    // Order: vulnerabilities first, then secrets, then misconfigurations
    expect(findings[0].vulnIdFromTool).toBe('CVE-1');
    expect(findings[1].vulnIdFromTool).toBe('secret-1');
    expect(findings[2].vulnIdFromTool).toBe('MC-1');
  });

  it('parses multiple Results', () => {
    const data = {
      Results: [
        {
          Target: 'a.json',
          Vulnerabilities: [{ VulnerabilityID: 'CVE-A', PkgName: 'p', Severity: 'HIGH' }],
        },
        {
          Target: 'b.json',
          Vulnerabilities: [{ VulnerabilityID: 'CVE-B', PkgName: 'p', Severity: 'LOW' }],
        },
      ],
    };
    const findings = parseTrivy(JSON.stringify(data));
    expect(findings).toHaveLength(2);
    expect(findings[0].filePath).toBe('a.json');
    expect(findings[1].filePath).toBe('b.json');
  });

  it('defaults Target to empty string when missing', () => {
    const data = {
      Results: [
        {
          Vulnerabilities: [{ VulnerabilityID: 'CVE-1', PkgName: 'p', Severity: 'HIGH' }],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))[0].filePath).toBe('');
  });

  // -- Edge cases --

  it('returns empty array for invalid JSON', () => {
    expect(parseTrivy('not json')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseTrivy('')).toEqual([]);
  });

  it('returns empty array when Results is missing', () => {
    expect(parseTrivy(JSON.stringify({}))).toEqual([]);
  });

  it('returns empty array when Results is empty', () => {
    expect(parseTrivy(JSON.stringify({ Results: [] }))).toEqual([]);
  });

  it('handles Result with no Vulnerabilities/Secrets/Misconfigurations', () => {
    const data = { Results: [{ Target: 'empty' }] };
    expect(parseTrivy(JSON.stringify(data))).toEqual([]);
  });

  it('handles empty Vulnerabilities/Secrets/Misconfigurations arrays', () => {
    const data = {
      Results: [
        {
          Target: 'f',
          Vulnerabilities: [],
          Secrets: [],
          Misconfigurations: [],
        },
      ],
    };
    expect(parseTrivy(JSON.stringify(data))).toEqual([]);
  });
});
