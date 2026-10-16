# Findings Forensic: ToB Skills A/B Audit — Final Report

Generated 2026-05-14 from manual finding-by-finding verification of the actual source code
behind every High-severity claim in the WITH-skills and NO-skills sigap-planner runs, plus
the four small-repo baseline-vs-skills comparisons.

## TL;DR

The "+18% High findings" claim from the prior report is **MISLEADING / WRONG-DIRECTION**.
After verifying every WITH-skills High finding against the actual source code:

| Repo | Baseline H | New (skills) H | Verdict |
|---|---:|---:|---|
| cosmetic_bot | 2 | 0 | **REGRESSION** — both real Highs lost |
| samokatbot | 9 | 2 | **REGRESSION** — 7 real Highs lost |
| rltrader | 13 | 14 | NEUTRAL — net +1 count, but mostly clone shuffling |
| sigap-planner | 6 | 14 | **COUNT INFLATED, SIGNAL DROPPED** — 5 of baseline's 6 real Highs were lost |

The headline `+24% Highs on sigap` went up purely because skills (a) split env-file/JWT issues
into 6 findings, (b) elevated client-side auth bugs from Medium→High, and simultaneously
**dropped** the DOM-XSS, NULL-password migration, hardcoded bearer fallback, and
middleware-doesn't-validate-JWT findings that baseline reliably caught.

**Recommendation: do NOT keep the ToB skills bundle as-is.** It produces a net loss of real
signal in 2/4 repos, marginal regression in 1/4, and synthetic count inflation in 1/4.

---

## Phase 1: sigap-planner A/B (`09d4...` WITH-skills vs `e3b5...` NO-skills, 2026-05-12 vs 2026-05-14)

- WITH-skills: 14 H, 13 M, 11 L
- NO-skills: 7 H, 18 M, 5 L

### Classification of all 14 WITH-skills Highs

| # | File:line | Class | Notes |
|---|---|---|---|
| 1 | `backend/.env:5` (DB password) | **splits-existing** | NO-skills had this lumped as `.env.backup:1` and `.env.sh:1` as 2 findings; WITH-skills broke each cred into its own |
| 2 | `backend/.env:10` (JWT default) | **splits-existing** | Same |
| 3 | `backend/.env:33` (bearer token) | **splits-existing** | Same |
| 4 | `backend/.env.backup:5` | **dup-of-baseline** | Same as NO-skills `.env.backup:1` |
| 5 | `backend/.env.sh:10` | **splits-existing** | |
| 6 | `backend/.env.sh:33` | **splits-existing** | |
| 7 | `backend/docs/openapi.yaml:28` (registration role) | **dup-of-baseline** | NO-skills caught this as `authController.ts:21` — same vuln, different file |
| 8 | `backend/secrets/firebase-sa.json.backup:1` | **dup-of-baseline** | NO-skills caught the primary file |
| 9 | `backend/src/controllers/authController.ts:8` (JWT secret fallback) | **unique-new-legit** | Real: `const JWT_SECRET = process.env.JWT_SECRET \|\| "change_this_secret"`. NO-skills missed. |
| 10 | `backend/src/controllers/userImportController.ts:20` | **unique-new-legit** | Real: route lacks authMiddleware, accepts Excel with plaintext passwords |
| 11 | `backend/src/routes/workorder.routes.ts:9` | **partial-overlap** | NO-skills caught the same file at line 22 with more specific SSRF framing. WITH-skills replaced with broader "multiple endpoints" — slight specificity regression. |
| 12 | `web/app/users/page.jsx:121` | **severity-inflation** | NO-skills had same bug at Medium severity (`Nav.jsx:54`) |
| 13 | `web/components/Nav.jsx:8` | **severity-inflation** | NO-skills had this at Medium |
| 14 | `web/components/RouteGuard.jsx:22` | **unique-new-legit** | Real, verified: `publicPaths = ['/login','/']` → every pathname startsWith('/'). Excellent catch. |

**Tally:** 3 unique-new-legit + 5 splits + 3 dups + 2 severity-inflation + 1 partial = 14. **Hallucinations: 0.**

### Highs the WITH-skills run MISSED that baseline caught

| Finding | Verified in source? | Notes |
|---|---|---|
| `backend/src/controllers/authController.ts:66` — login no rate limit | YES | **REGRESSION** |
| `web/middleware.js:19` — middleware checks token presence but never validates JWT | YES | **REGRESSION** |
| `backend/migration/015_add_lead_shift_user.sql:4` — NULL password user with privileged role | YES | **REGRESSION** |
| `backend/src/controllers/workOrderController.ts:15` — hardcoded SIGAP bearer token fallback in code | YES | **REGRESSION** |
| `web/app/monitor/daily-weekly/page.jsx:280,383,394,407` — DOM-based XSS via `document.write(html)` | YES | **REGRESSION** |
| `web/lib/api-client.ts:88` — passwords logged to console | YES | **REGRESSION** |

**File overlap on sigap:** Of all flagged files, only **3 files appear in both** runs
(`backend/package.json`, `backend/src/app.ts`, `web/app/login/page.jsx`). 14 baseline files
dropped from WITH-skills coverage; WITH-skills hits 28 different files. Skills are
redirecting Claude's attention away from where the real bugs live.

### Sigap A/B verdict

Of the +7 High count delta: 5 are pure splits, 2 are severity inflation. **Zero of the +7
are truly new legit findings**. Meanwhile WITH-skills LOST ≥5 real High-severity bugs from
baseline. Net signal: **-2 real Highs**, hidden behind a +7 count.

---

## Phase 2: Per-repo summary (baseline vs first-skills, 2026-05-06/07 → 2026-05-12)

### cosmetic_bot — REGRESSION (2 → 0 Highs)

Baseline Highs (verified real):
- `.env` and `.env.example` contain real Telegram bot token `7847693553:AAEa04Nd...` and OpenAI API key — committed to git history.

WITH-skills replaced these with one Medium ("OPENAI_API_KEY loaded but unused" — downgraded
severity AND misses the real exposure) and one Low ("python-dotenv unpinned").

**Skills missed the most obvious High in this repo.** Real Telegram bot token = full bot
impersonation. Real OpenAI key = unbounded billing exposure.

### samokatbot — REGRESSION (9 → 2 Highs)

Baseline caught 9 Highs, every one verified real:
1. Hardcoded `BOT_TOKEN=7774343253:AAEN...` and `ADMIN_ID=2044240608` in `.env`
2. HTML injection via `ParseMode.HTML` + user-controlled `validated_data.name` (router.py:24-35)
3. `POST /api/appointment` no auth
4. IDOR via user-controlled `user_id`
5. Admin auth via spoofable `F.from_user.id`
6. Admin panel URL uses client-supplied `admin_id` query param
7. Unauthenticated webhook accepts forged updates
8. Webhook has no `secret_token` configured
9. Same bot token hardcoded in `p.py:9` as string literal

WITH-skills kept only #4 and partially #5. **Dropped 7 real Highs**, including the
hardcoded token plainly visible in both `.env` and `p.py`.

### rltrader — NEUTRAL net +1 (with concerning shuffle)

Baseline: 13 H. WITH-skills: 14 H. File-level overlap only 5/13 baseline files.

WITH-skills new legit catches:
- `torch.load` pickle deserialization (real)
- Streamlit `text_input` → SQL via user-supplied table name (real — manual_label.py:53/305)

WITH-skills lost coverage of:
- `cf.py:8` — hardcoded Telegram bot token `1642869241:AAFMJsQ...`
- `main.py:29` — hardcoded MySQL `password = '[REDACTED]'`
- `telegram_utils.py` — token in GET URL
- `db_connection.py` — raw SQL execution
- `mysql_loader.py`, `change_mysql.py`, `lstm_cnn_model.py`, `train_rl.py` — SQL injection clones

WITH-skills replaced these with 7 OTHER files containing the same systemic SQL-injection
clone pattern. Net: 2 truly new findings, 3+ real misses. **Slight regression.**

### sigap-planner — COUNT-UP / SIGNAL-DOWN (see Phase 1)

Counts went +8 Highs. Real-signal Highs went **-2** after accounting for splits, dups,
severity inflation, and regressions.

---

## Phase 3: Reproducibility reruns (2026-05-14, skills enabled, fresh run)

| Repo | First skills run H | Rerun H | Variance | Verdict |
|---|---:|---:|---|---|
| cosmetic_bot | 0 | 0 | Stable | Reproducibly misses the real secrets |
| samokatbot | 2 | 1 | -1 | Already-regressed run dropped further |
| rltrader | 14 | pending | — | — |
| sigap-planner | 14 | pending | — | — |

Cosmetic_bot rerun (`7c465319...`) findings: 0 H, 2 M. Same skills bundle, same repo, two
days later — **still misses the .env secrets**. This is reproducible, not noise.

Samokatbot rerun (`ec560057...`) findings: 1 H, 0 M, 2 L. From baseline-9 → first-skills-2
→ rerun-1. **High run-to-run variance on a regressed baseline.**

---

## Hallucination / dup / splitting rates

- **Hallucination rate**: 0% on the 14 sigap WITH-skills Highs. Every described vulnerability exists in code.
- **Splitting rate**: 36% (5/14) — env-file credentials split across `.env`, `.env.sh`, `.env.backup` × {DB pw, JWT secret, bearer token}.
- **Dup-of-baseline rate**: 21% (3/14) — same bug, different file form.
- **Severity-inflation rate**: 14% (2/14) — Medium-class client-side auth bugs upgraded to High.
- **Truly novel-and-legit**: 21% (3/14) — only RouteGuard startsWith('/'), JWT secret fallback in authController, and userImportController no-auth.
- **Regression rate**: ≥5 real Highs lost on sigap, 7/9 on samokatbot, 2/2 on cosmetic_bot, ~3 on rltrader.

---

## Bottom-line verdict

**The ToB skills bundle is NOT worth keeping as-is.**

1. 2 of 4 repos regressed significantly (cosmetic_bot, samokatbot).
2. 1 of 4 was net-neutral with concerning shuffle (rltrader).
3. 1 of 4 had inflated counts that mask a -2 real-signal regression (sigap-planner).
4. The "+18% / +24% Highs" headline numbers are an artifact of credential-leak splitting + severity reclassification + Claude attention shifting to different files, **not** deeper analysis.
5. Coverage redirection: only 3 files overlap between baseline and skills on sigap — skills are pulling Claude away from files where the most damaging bugs live (DOM XSS, NULL-password admin user, hardcoded JWT in code, middleware that doesn't validate JWT).
6. Reproducibility (where measured): the regressions are reproducible. Cosmetic_bot misses the real Telegram + OpenAI secrets in BOTH skill-enabled runs.

### Suggested next steps

- **Roll back the bundled skill set**, or scope to a single skill at a time and re-benchmark.
- **Add a deterministic check** on committed `.env` files independent of skill bundle — any non-placeholder secret in a committed `.env` is automatically a High regardless of which AI prompts run.
- **Consolidate splits**: if the same secret appears in `.env`, `.env.sh`, `.env.backup` with identical value, collapse to one finding.
- **Future benchmarks must compare by `fingerprint`, not by count**. Counts are gameable (and were gamed here, unintentionally). Fingerprints aren't.

---

## Source verification (sample)

All findings cross-checked against actual repo files (paths in `/workspace/<repo>/repo/`):
- sigap `backend/.env` — confirmed `DB_PASSWORD=[REDACTED]`, `JWT_SECRET=change_this_secret`, real long-lived JWT bearer token
- sigap `backend/src/controllers/authController.ts:8` — confirmed JWT secret fallback to "change_this_secret"
- sigap `web/components/RouteGuard.jsx` — confirmed `publicPaths = ['/login','/']` + `startsWith` bug
- sigap `web/middleware.js` — confirmed middleware only checks cookie presence
- sigap `backend/migration/015_add_lead_shift_user.sql` — confirmed NULL password admin-class user
- sigap `web/app/monitor/daily-weekly/page.jsx` — confirmed `doc.write(html)` DOM XSS at lines 383, 394, 407
- cosmetic_bot `.env` and `.env.example` — confirmed real Telegram bot token + OpenAI key
- samokatbot `.env` — confirmed `BOT_TOKEN=7774343253:AAEN...`
- samokatbot `p.py:9` — confirmed same token as string literal
- samokatbot `app/api/router.py:24-35` — confirmed `f"... <b>{validated_data.name}</b>"` HTML interpolation
- rltrader `cf.py:7-9` — confirmed real Telegram bot token committed
- rltrader `main.py:29` — confirmed hardcoded `password = '[REDACTED]'`
