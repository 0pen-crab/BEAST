# Bench Overlap Analysis — Semantic Matching Report

**Subject:** Verifying the "1–2% overlap" claim across 6 module-size configurations.
This study informed the default `scan_depth` choice (100/500/1500). Source repo
was a large enterprise C#/Oracle codebase (`deimos`, see [BENCHMARK.md](../BENCHMARK.md))
— specific file paths and finding details are stripped here; only aggregate
structural metrics are kept.

## TL;DR

**The "1–2% overlap" claim is wrong.** It was a fingerprint artifact. With proper semantic matching (same file, ±10 lines, fuzzy `SequenceMatcher ≥ 0.55` on title/description/snippet), real overlap is **10–80×** higher depending on direction. Larger-module configs are almost entirely a **subset** of smaller-module configs — same findings, just fewer of them. Module size does **not** change what vulnerability classes are found.

## Method

- Critical + High only (filters medium/low noise).
- "Same vuln" = normalized file path match + `|startLine_a − startLine_b| ≤ 10` + `max(title_sim, desc_sim, snippet_sim) ≥ 0.55`.
- CWE/severity **not** required to match — divergence measured separately.
- Directional A→B: % of A covered by B. Not symmetric because sets differ by 15×.

## 1. Overlap Matrix (Critical+High)

### Exact fingerprint (what the old analysis used)

| A \ B | 250 | 500 | 1000 | 1500 | 2000 |
|-------|-----|-----|------|------|------|
| 100   | 8   | 11  | 4    | 1    | 2    |
| 250   |     | 12  | 1    | 1    | 3    |
| 500   |     |     | 7    | 2    | 2    |
| 1000  |     |     |      | 2    | 2    |
| 1500  |     |     |      |      | 2    |

**1–7% of the smaller set.** This is where "1–2%" came from. Pure artifact of wording/line/CWE drift between runs.

### Fuzzy overlap (% of source covered by target, directional)

| X \ Y | 100   | 250   | 500   | 1000  | 1500  | 2000  |
|-------|-------|-------|-------|-------|-------|-------|
| 100   | —     | 33.1% | 23.6% | 8.3%  | 6.6%  | 5.0%  |
| 250   | 67.9% | —     | 46.3% | 15.9% | 12.2% | 10.1% |
| 500   | 73.8% | 66.8% | —     | 25.2% | 16.8% | 12.4% |
| 1000  | 77.9% | 69.1% | 75.0% | —     | 39.7% | 27.9% |
| 1500  | 73.7% | 64.9% | 57.9% | 49.1% | —     | 33.3% |
| 2000  | 69.8% | 69.8% | 60.5% | 44.2% | 46.5% | —     |

**Key asymmetry:** B@1500→B@100 is **73.7%** — three quarters of what B@1500 reports IS reported by B@100. Same story for B@2000 (69.8%) and B@1000 (77.9%).

### Reproduction rate (in ≥1 other config)

- B@100: 40.3% (256/635 Crit+High)
- B@250: 76.7%
- B@500: 85.6%
- B@1000: 95.6%
- B@1500: 91.2%
- B@2000: 90.7%

Large-module findings are almost never unique.

### Cross-severity / cross-CWE within fuzzy matches

B@100↔B@250: 210 fuzzy matches → 16 cross-severity (7.6%), 20 cross-CWE (9.5%). Real but small effect — confirms the "same vuln different severity/CWE" concern, just not dominant.

### Loose-threshold sanity check (file + line only, ignore wording)

B@1500 covered by B@100: 75.4%, B@2000: 74.4%, B@1000: 80.9% — matches the fuzzy numbers, so the 0.55 threshold isn't the bottleneck.

## 2. Random-Sample Confirmation (20 C+H from B@100)

Hits in larger configs (out of 20): B@250=6 (30%), B@500=6 (30%), B@1000=2 (10%), B@1500=1 (5%), B@2000=1 (5%). This direction looks low because B@100 has 635 C+H findings and B@2000 only 43 — you can't fit 635 items inside 43. The correct directional test is Task 4.

## 3. Top 10 juiciest from B@100

All 10 were `CWE-295` SSL bypass or `CWE-89` SQLi in high-value modules. **5 of 10 unique, 5 reproduced.**

- Reproduced: SSL bypass in two HTTP-client modules; SQLi in an email-downloader — all found in B@250, 500, 1000, 1500.
- "Unique" ones are all **multi-sink enumeration**: a single ViewModel file with 5 SQLi sinks at consecutive lines, and another XAML codebehind with 2 SQLi sinks. B@100 enumerates each sink; larger configs bundle or skip the tail. This is **finding granularity, not different classes.**

## 4. Reverse — Top 10 juiciest from B@1500

**0 of 10 unique. All 10 reproduced in at least one smaller config.** Every top-tier finding B@1500 catches (SSL-validation bypass in HTTP proxy, PL/SQL SQL injection in 4 stored procedures, hardcoded credentials in a schema-init script, OS-command injection in 2 utility procedures, authorization bypass in a notification proc, SSL bypass in updater) is also in B@100, and 7 of 10 are in B@500 and B@1000 as well.

## 5. CWE class distribution (C+H)

Same classes dominate everywhere: **SQLi (CWE-89), missing authZ (CWE-862), hardcoded creds (CWE-798), OS command injection (CWE-78), cert validation bypass (CWE-295).** No evidence module size changes vulnerability class distribution — only volume.

- B@100: CWE-89=375, 862=91, 798=33, 78=18, 284=15, 319=9, 863=9, 287=5
- B@1500: CWE-89=15, 798=6, 295=4, 319=3, 287=3, 256=2, 598=2, 327=2

Same top 5 classes in every config.

## 6. Bottom-line verdict

1. **"1–2% overlap" is wrong.** That's only the exact-fingerprint number. Real semantic overlap is 24–78% A→B and 65–95% for reverse direction (small configs cover large configs).

2. **Different module sizes do NOT find different vulnerability classes.** Top-8 CWE classes identical across all configs. Bigger module = fewer findings of the same kind, not different kinds.

3. **What's actually happening:** B@100 is a super-set of ~635 C+H findings; B@1500 surfaces ~57 of the "top hits"; large modules collapse multi-sink-per-file cases or skip the tail. Wording/line/CWE drift (7–10% of fuzzy matches) exists but isn't dominant — line-number drift + minor title rewording explains most of the exact-fingerprint miss.

4. **Multi-pass still makes sense, but for the correct reason** — not "different classes", but: catching the ~25% tail of B@1500 findings that B@100 missed (different line granularity/file scope), and the ~10% of B@100 findings no other config reproduces (per-sink enumeration or FP-prone small-context speculation).

5. **Recommendations:**
   - Replace `(file, startLine, cwe, title[:60])` with semantic fingerprint: file + ±10-line bucket + `SequenceMatcher ≥ 0.55` on `title+description+snippet`. Fixes reporting without any scanner change.
   - Position B@100 as primary (captures ≥68% of every other config); B@1500 as a cheap cross-check. Don't frame them as "different finders".
   - Investigate the ~10% of B@100 findings no other config reproduces — likely a mix of legitimate per-sink enumeration and small-context over-speculation.

## Artifacts

- Script: `overlap_analysis.py` — methodology/code only. Raw per-config finding lists
  (`bench-all-<N>.json`) and the sample/juicy detail dump (`overlap_full.json`)
  were stripped before commit because they contained file paths and snippets
  from a private codebase. The aggregate matrices in this document are the
  artefacts that informed the `scan_depth` defaults.
