#!/usr/bin/env python3
"""Overlap analysis for bench configs — exact vs fuzzy matching."""
import json
import re
from difflib import SequenceMatcher
from itertools import combinations
from collections import defaultdict
import random

CONFIGS = [100, 250, 500, 1000, 1500, 2000]
LINE_TOL = 10  # startLine ±10 lines
SEM_THRESH = 0.55  # SequenceMatcher ratio threshold for semantic similarity


def load(n):
    with open(f'/tmp/bench-all-{n}.json') as f:
        return json.load(f)


def norm_text(s):
    if not s:
        return ''
    s = s.lower()
    s = re.sub(r'[^a-z0-9\s]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def norm_path(p):
    return (p or '').replace('\\', '/').strip().lower()


def is_critical_or_high(f):
    return f.get('severity', '').lower() in ('critical', 'high')


def exact_fingerprint(f):
    """Naive fingerprint: (file, startLine, cwe, title[:60])"""
    return (
        norm_path(f.get('file')),
        f.get('startLine'),
        (f.get('cwe') or '').upper().strip(),
        (f.get('title') or '')[:60].strip().lower(),
    )


def text_sim(a, b):
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, norm_text(a), norm_text(b)).ratio()


def semantic_match(f1, f2):
    """Same file, nearby line, similar title OR description OR snippet."""
    if norm_path(f1.get('file')) != norm_path(f2.get('file')):
        return False, 0.0
    l1 = f1.get('startLine') or 0
    l2 = f2.get('startLine') or 0
    if abs(l1 - l2) > LINE_TOL:
        return False, 0.0
    # semantic: best of title/desc/snippet similarity
    t_sim = text_sim(f1.get('title'), f2.get('title'))
    d_sim = text_sim(f1.get('description'), f2.get('description'))
    s_sim = text_sim(f1.get('snippet'), f2.get('snippet'))
    best = max(t_sim, d_sim, s_sim)
    return (best >= SEM_THRESH), best


def build_file_index(findings):
    idx = defaultdict(list)
    for f in findings:
        idx[norm_path(f.get('file'))].append(f)
    return idx


def find_best_match(target, candidates_idx):
    """Find best fuzzy match in candidates (indexed by file)."""
    file_key = norm_path(target.get('file'))
    if file_key not in candidates_idx:
        return None, 0.0
    best = None
    best_sim = 0.0
    for c in candidates_idx[file_key]:
        ok, sim = semantic_match(target, c)
        if ok and sim > best_sim:
            best = c
            best_sim = sim
    return best, best_sim


def compute_overlap(a_findings, b_findings):
    """Return dict of exact / fuzzy / cross-sev / cross-cwe counts."""
    a_ch = [f for f in a_findings if is_critical_or_high(f)]
    b_ch = [f for f in b_findings if is_critical_or_high(f)]

    # Exact fingerprint overlap on crit+high
    a_fp = {exact_fingerprint(f) for f in a_ch}
    b_fp = {exact_fingerprint(f) for f in b_ch}
    exact = len(a_fp & b_fp)

    # Fuzzy: for each A finding, search for a fuzzy match in B
    b_idx = build_file_index(b_ch)
    fuzzy_matches = 0
    cross_sev_matches = 0
    cross_cwe_matches = 0
    for fa in a_ch:
        fb, _sim = find_best_match(fa, b_idx)
        if fb is not None:
            fuzzy_matches += 1
            if (fa.get('severity', '').lower() != fb.get('severity', '').lower()):
                cross_sev_matches += 1
            if ((fa.get('cwe') or '').upper() != (fb.get('cwe') or '').upper()):
                cross_cwe_matches += 1

    return {
        'a_count': len(a_ch),
        'b_count': len(b_ch),
        'exact': exact,
        'fuzzy': fuzzy_matches,
        'cross_sev': cross_sev_matches,
        'cross_cwe': cross_cwe_matches,
        'exact_pct': 100.0 * exact / max(1, min(len(a_ch), len(b_ch))),
        'fuzzy_pct': 100.0 * fuzzy_matches / max(1, len(a_ch)),
    }


def main():
    data = {n: load(n) for n in CONFIGS}

    print('=' * 90)
    print('OVERLAP MATRIX (Critical + High only)')
    print('=' * 90)

    overlap_results = {}
    for a, b in combinations(CONFIGS, 2):
        r = compute_overlap(data[a], data[b])
        overlap_results[(a, b)] = r
        print(f'\nB@{a} ({r["a_count"]} C+H) vs B@{b} ({r["b_count"]} C+H)')
        print(f'  Exact fingerprint matches:   {r["exact"]:>4} '
              f'({r["exact_pct"]:.1f}% of min)')
        print(f'  Fuzzy matches (A→B):         {r["fuzzy"]:>4} '
              f'({r["fuzzy_pct"]:.1f}% of A)')
        print(f'  ...of which cross-severity:  {r["cross_sev"]:>4}')
        print(f'  ...of which cross-CWE:       {r["cross_cwe"]:>4}')

    # Save for report
    with open('/tmp/overlap_results.json', 'w') as f:
        json.dump({f'{a}_{b}': v for (a, b), v in overlap_results.items()},
                  f, indent=2)

    # -----------------------------------------------------------------
    # Task 2: Sample 20 random findings from B@100, search each larger config
    # -----------------------------------------------------------------
    print('\n' + '=' * 90)
    print('SAMPLE: 20 random C+H findings from B@100')
    print('=' * 90)
    random.seed(42)
    b100_ch = [f for f in data[100] if is_critical_or_high(f)]
    sample = random.sample(b100_ch, 20)
    targets = [250, 500, 1000, 1500, 2000]
    idxs = {t: build_file_index([f for f in data[t] if is_critical_or_high(f)])
            for t in targets}

    sample_rows = []
    hits_by_target = {t: 0 for t in targets}
    for i, f in enumerate(sample, 1):
        row = {
            'i': i,
            'file': f['file'],
            'line': f.get('startLine'),
            'cwe': f.get('cwe'),
            'sev': f.get('severity'),
            'title': (f.get('title') or '')[:80],
        }
        hits = {}
        for t in targets:
            m, sim = find_best_match(f, idxs[t])
            if m is not None:
                hits[t] = {
                    'sev': m.get('severity'),
                    'cwe': m.get('cwe'),
                    'line': m.get('startLine'),
                    'sim': round(sim, 2),
                }
                hits_by_target[t] += 1
            else:
                hits[t] = None
        row['hits'] = hits
        sample_rows.append(row)
        hit_cols = ' '.join(
            f'{t}:{"+" if hits[t] else "-"}' for t in targets)
        print(f'[{i:>2}] {row["sev"]:<8} {row["cwe"]:<10} '
              f'L{str(row["line"]):<5} {row["file"][-50:]:<50} | {hit_cols}')

    print('\nHits per larger config (out of 20 B@100 samples):')
    for t in targets:
        print(f'  B@{t}: {hits_by_target[t]}/20 '
              f'({100*hits_by_target[t]/20:.0f}%)')

    # -----------------------------------------------------------------
    # Task 3: 10 "juiciest" C+H from B@100 (pick high-confidence critical)
    # -----------------------------------------------------------------
    print('\n' + '=' * 90)
    print('TOP 10 JUICIEST C+H FROM B@100 — check presence in other configs')
    print('=' * 90)
    # Prioritize: critical > high, confidence=high, prefer injection/auth CWEs
    JUICY_CWES = {'CWE-89', 'CWE-79', 'CWE-77', 'CWE-78', 'CWE-352',
                  'CWE-22', 'CWE-434', 'CWE-502', 'CWE-798',
                  'CWE-295', 'CWE-287', 'CWE-862', 'CWE-863', 'CWE-306'}

    def juicy_score(f):
        s = 0
        if f.get('severity', '').lower() == 'critical':
            s += 10
        if f.get('confidence', '').lower() == 'high':
            s += 3
        if (f.get('cwe') or '').upper() in JUICY_CWES:
            s += 5
        return s

    ranked = sorted(b100_ch, key=juicy_score, reverse=True)
    juicy10 = ranked[:10]
    juicy_report = []
    for i, f in enumerate(juicy10, 1):
        hits = {}
        for t in targets:
            m, sim = find_best_match(f, idxs[t])
            hits[t] = {
                'found': m is not None,
                'sev': m.get('severity') if m else None,
                'cwe': m.get('cwe') if m else None,
                'sim': round(sim, 2) if m else None,
            }
        found_in = [t for t in targets if hits[t]['found']]
        juicy_report.append({'f': f, 'hits': hits, 'found_in': found_in})
        print(f'\n[{i}] {f.get("severity")} {f.get("cwe")} '
              f'{f.get("file")}:{f.get("startLine")}')
        print(f'    Title: {(f.get("title") or "")[:100]}')
        print(f'    Found in: {found_in if found_in else "NONE (unique to B@100)"}')

    unique_to_100 = sum(1 for j in juicy_report if not j['found_in'])
    print(f'\nOf 10 juiciest from B@100: {unique_to_100} unique '
          f'(not in any larger config), {10 - unique_to_100} reproduced in at least one')

    # -----------------------------------------------------------------
    # Task 4: Reverse — 10 C+H from B@1500, check smaller configs
    # -----------------------------------------------------------------
    print('\n' + '=' * 90)
    print('REVERSE: 10 C+H from B@1500 — check presence in smaller configs')
    print('=' * 90)
    b1500_ch = [f for f in data[1500] if is_critical_or_high(f)]
    ranked_1500 = sorted(b1500_ch, key=juicy_score, reverse=True)
    juicy10_r = ranked_1500[:10]
    small_targets = [100, 250, 500, 1000]
    small_idxs = {t: build_file_index(
        [f for f in data[t] if is_critical_or_high(f)]) for t in small_targets}

    reverse_report = []
    for i, f in enumerate(juicy10_r, 1):
        hits = {}
        for t in small_targets:
            m, sim = find_best_match(f, small_idxs[t])
            hits[t] = {'found': m is not None,
                       'sev': m.get('severity') if m else None,
                       'cwe': m.get('cwe') if m else None,
                       'sim': round(sim, 2) if m else None}
        found_in = [t for t in small_targets if hits[t]['found']]
        reverse_report.append({'f': f, 'hits': hits, 'found_in': found_in})
        print(f'\n[{i}] {f.get("severity")} {f.get("cwe")} '
              f'{f.get("file")}:{f.get("startLine")}')
        print(f'    Title: {(f.get("title") or "")[:100]}')
        print(f'    Found in: {found_in if found_in else "NONE (unique to B@1500)"}')

    unique_1500 = sum(1 for j in reverse_report if not j['found_in'])
    print(f'\nOf 10 juiciest from B@1500: {unique_1500} unique, '
          f'{10 - unique_1500} reproduced in at least one smaller config')

    # -----------------------------------------------------------------
    # CWE-class distribution per config (Critical+High)
    # -----------------------------------------------------------------
    print('\n' + '=' * 90)
    print('CWE class distribution (C+H) per config — are classes really different?')
    print('=' * 90)
    cwe_stats = {}
    for n in CONFIGS:
        counts = defaultdict(int)
        for f in data[n]:
            if is_critical_or_high(f):
                counts[(f.get('cwe') or 'NONE').upper()] += 1
        cwe_stats[n] = counts
        top = sorted(counts.items(), key=lambda x: -x[1])[:8]
        print(f'\nB@{n} top CWEs (C+H): ' +
              ', '.join(f'{c}={v}' for c, v in top))

    # Save full report data
    dump = {
        'overlap': {f'{a}_{b}': v for (a, b), v in overlap_results.items()},
        'sample20': sample_rows,
        'sample20_hits_by_target': hits_by_target,
        'juicy_b100': [
            {
                'file': j['f']['file'],
                'line': j['f'].get('startLine'),
                'cwe': j['f'].get('cwe'),
                'sev': j['f'].get('severity'),
                'title': j['f'].get('title'),
                'found_in': j['found_in'],
                'hits': j['hits'],
            } for j in juicy_report
        ],
        'juicy_b1500': [
            {
                'file': j['f']['file'],
                'line': j['f'].get('startLine'),
                'cwe': j['f'].get('cwe'),
                'sev': j['f'].get('severity'),
                'title': j['f'].get('title'),
                'found_in': j['found_in'],
                'hits': j['hits'],
            } for j in reverse_report
        ],
        'cwe_stats': {str(n): dict(v) for n, v in cwe_stats.items()},
    }
    with open('/tmp/overlap_full.json', 'w') as fh:
        json.dump(dump, fh, indent=2)


if __name__ == '__main__':
    main()
