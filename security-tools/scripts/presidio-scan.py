#!/usr/bin/env python3
"""Presidio PII scanner wrapper — walks repo files, detects personal data, outputs SARIF."""

import json
import os
import sys
from pathlib import Path

from presidio_analyzer import AnalyzerEngine

# File extensions to scan (text-based files only)
TEXT_EXTENSIONS = {
    '.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.go', '.rb', '.php',
    '.cs', '.c', '.cpp', '.h', '.hpp', '.rs', '.swift', '.kt', '.scala',
    '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
    '.html', '.htm', '.css', '.scss', '.less', '.svg',
    '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
    '.xml', '.csv', '.tsv', '.sql', '.graphql', '.proto',
    '.md', '.txt', '.rst', '.adoc', '.tex',
    '.dockerfile', '.tf', '.hcl', '.tfvars',
    '.properties', '.gradle', '.pom',
}

# Directories to skip
SKIP_DIRS = {
    '.git', 'node_modules', '__pycache__', '.venv', 'venv', 'vendor',
    'dist', 'build', '.next', '.nuxt', 'target', 'bin', 'obj',
    '.tox', '.mypy_cache', '.pytest_cache', '.eggs',
}

# Max file size to scan (512KB)
MAX_FILE_SIZE = 512 * 1024

# All PII findings are Info severity (mapped to SARIF 'note' level)
SEVERITY_MAP: dict[str, str] = {}


def should_scan(filepath: Path) -> bool:
    if filepath.suffix.lower() not in TEXT_EXTENSIONS and filepath.name.lower() not in {
        'dockerfile', 'makefile', 'gemfile', 'rakefile', 'vagrantfile',
    }:
        return False
    try:
        return filepath.stat().st_size <= MAX_FILE_SIZE
    except OSError:
        return False


def scan_repo(repo_path: str, output_path: str) -> None:
    analyzer = AnalyzerEngine()
    results = []
    rules = {}
    rule_index = {}

    repo = Path(repo_path)

    for dirpath, dirnames, filenames in os.walk(repo):
        # Prune skipped directories
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]

        for fname in filenames:
            fpath = Path(dirpath) / fname
            if not should_scan(fpath):
                continue

            try:
                content = fpath.read_text(encoding='utf-8', errors='ignore')
            except (OSError, UnicodeDecodeError):
                continue

            if not content.strip():
                continue

            analyzer_results = analyzer.analyze(
                text=content,
                language='en',
                entities=[
                    'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IP_ADDRESS',
                    'CREDIT_CARD', 'IBAN_CODE',
                    'US_SSN', 'US_DRIVER_LICENSE', 'MEDICAL_LICENSE',
                ],
            )

            lines = content.split('\n')
            for finding in analyzer_results:
                if finding.score < 0.7:
                    continue

                # Determine line number from character offset
                char_count = 0
                line_num = 1
                for i, line in enumerate(lines):
                    if char_count + len(line) + 1 > finding.start:
                        line_num = i + 1
                        break
                    char_count += len(line) + 1

                entity_type = finding.entity_type
                rel_path = str(fpath.relative_to(repo))
                matched_text = content[finding.start:finding.end]

                # Redact the middle of matched text for display
                if len(matched_text) > 6:
                    visible = max(2, len(matched_text) // 4)
                    redacted = matched_text[:visible] + '***' + matched_text[-visible:]
                else:
                    redacted = '***'

                # Build rule ID
                rule_id = f'pii/{entity_type.lower()}'
                if rule_id not in rule_index:
                    rule_index[rule_id] = len(rules)
                    rules[rule_id] = {
                        'id': rule_id,
                        'name': entity_type,
                        'shortDescription': {'text': f'PII detected: {entity_type.replace("_", " ").title()}'},
                        'fullDescription': {'text': f'Presidio detected {entity_type.replace("_", " ").lower()} in source code.'},
                        'defaultConfiguration': {
                            'level': 'note',
                        },
                    }

                results.append({
                    'ruleId': rule_id,
                    'ruleIndex': rule_index[rule_id],
                    'level': 'note',
                    'message': {
                        'text': f'{entity_type.replace("_", " ").title()} detected: {redacted} (confidence: {finding.score:.0%})',
                    },
                    'locations': [{
                        'physicalLocation': {
                            'artifactLocation': {'uri': rel_path},
                            'region': {
                                'startLine': line_num,
                                'startColumn': finding.start - char_count + 1,
                            },
                        },
                    }],
                    'properties': {
                        'matchedText': matched_text,
                    },
                })

    # Build SARIF output
    sarif = {
        'version': '2.1.0',
        '$schema': 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
        'runs': [{
            'tool': {
                'driver': {
                    'name': 'Presidio',
                    'informationUri': 'https://microsoft.github.io/presidio',
                    'rules': list(rules.values()),
                },
            },
            'results': results,
            'invocations': [{
                'executionSuccessful': True,
                'exitCode': 0,
            }],
        }],
    }

    with open(output_path, 'w') as f:
        json.dump(sarif, f, indent=2)

    print(f'[presidio] Found {len(results)} PII findings in {repo_path}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f'Usage: {sys.argv[0]} <repo_path> <output_sarif_path>', file=sys.stderr)
        sys.exit(1)

    scan_repo(sys.argv[1], sys.argv[2])
