#!/usr/bin/env node
// jfrog-sca.mjs — JFrog Xray SCA WITHOUT Advanced Security (JAS).
//
// `jf audit` unconditionally checks the contextual_analysis (JAS) entitlement
// and dies on 403 when a plan lacks JAS. SCA is core Xray and JAS-independent,
// so we call the REST scan/graph API directly:
//   1. Recursively find projects and collect their DIRECT (declared) dependencies
//      with exact versions → Xray component_ids (npm://, gav://, pypi://, …).
//      DIRECT ONLY — we read the manifest (package.json, pom.xml, go.mod, …) for
//      declared deps and resolve exact versions from the lock file. Transitive
//      deps-of-deps are intentionally NOT included.
//   2. POST /xray/api/v1/scan/graph?include_vulnerabilities=true  → scan_id
//   3. Poll GET /xray/api/v1/scan/graph/{id}?include_vulnerabilities=true
//   4. Emit SARIF (consumed by BEAST's existing SARIF parser).
//
// Usage: node jfrog-sca.mjs <repoPath> <outSarif>   Env: JF_URL, JF_ACCESS_TOKEN
// Needs only a token with Xray scan permissions — no JAS, no `jf` CLI, no curl.
import fs from 'fs';
import path from 'path';

const [, , REPO, OUT] = process.argv;
const URL = (process.env.JF_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.JF_ACCESS_TOKEN || '';
if (!REPO || !OUT) { console.error('usage: jfrog-sca.mjs <repoPath> <outSarif>'); process.exit(2); }
if (!URL || !TOKEN) { console.error('jfrog-sca: JF_URL / JF_ACCESS_TOKEN not set'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (dir, name) => { try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { return null; } };
const ls = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
const clean = (v) => (v || '').toString().trim().replace(/^[v=^~><\s]+/, '');
const isVer = (v) => /^[0-9]/.test(v);

// ── Recursive project discovery ───────────────────────────────────────────────
const SKIP = new Set(['node_modules', '.git', 'vendor', 'target', 'build', 'dist', '.gradle', 'bin', 'obj', '.next', '.venv', '__pycache__']);
const MARKERS = new Set(['package.json', 'go.mod', 'Gemfile.lock', 'composer.json', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'Cargo.toml', 'pubspec.yaml', 'Pipfile', 'pyproject.toml', 'Package.resolved', 'conanfile.txt', 'conan.lock', 'packages.config']);
function findProjectDirs() {
  const dirs = new Set(); let walked = 0;
  const walk = (d, depth) => {
    if (depth > 8 || walked > 20000) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      walked++;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(d, e.name), depth + 1); }
      else if (MARKERS.has(e.name) || /\.(cs|fs|vb)proj$/.test(e.name) || /^requirements.*\.txt$/.test(e.name)) dirs.add(d);
    }
  };
  walk(REPO, 0); dirs.add(REPO);
  return [...dirs];
}

// ── version maps from lock files (name → exact version) ───────────────────────
function npmLockMap(dir) {
  const map = {};
  const pl = rd(dir, 'package-lock.json');
  if (pl) try { const d = JSON.parse(pl); for (const [k, i] of Object.entries(d.packages || {})) { const x = k.lastIndexOf('node_modules/'); if (x >= 0 && i.version) map[k.slice(x + 13)] = i.version; } const w = (deps) => { for (const [n, i] of Object.entries(deps || {})) if (i.version) map[n] = i.version; }; w(d.dependencies); } catch {}
  const yl = rd(dir, 'yarn.lock');
  if (yl) for (const block of yl.split(/\n(?=\S)/)) { const v = block.match(/\n\s+version:?\s+"?([^"\n]+)"?/); if (!v) continue; for (const spec of block.split('\n')[0].split(',')) { const s = spec.trim().replace(/:$/, '').replace(/^"|"$/g, ''); const at = s.lastIndexOf('@'); if (at > 0) map[s.slice(0, at)] = v[1].trim(); } }
  const pn = rd(dir, 'pnpm-lock.yaml');
  if (pn) for (const m of pn.matchAll(/^  \/?((?:@[^/@\s]+\/)?[^@/\s]+)@([0-9][^():\s]*)[:(]/gm)) map[m[1]] = m[2];
  return map;
}

// ── DIRECT-dependency parsers ─────────────────────────────────────────────────
function npmDirect(c, dir) {
  const pj = rd(dir, 'package.json'); if (!pj) return; let d; try { d = JSON.parse(pj); } catch { return; }
  const map = npmLockMap(dir);
  for (const sec of ['dependencies', 'devDependencies', 'optionalDependencies'])
    for (const [n, range] of Object.entries(d[sec] || {})) { const v = map[n] || clean(range); if (isVer(v)) c.add(`npm://${n}:${v}`); }
}
function pyDirect(c, dir) {
  // requirements*.txt pinned (==) are already direct+exact
  for (const f of ls(dir).filter((x) => /^requirements.*\.txt$/.test(x)))
    for (const line of (rd(dir, f) || '').split('\n')) { const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*==\s*([0-9][^\s;#]*)/); if (m) c.add(`pypi://${m[1].toLowerCase()}:${m[2]}`); }
  // poetry: direct = pyproject [tool.poetry.dependencies]; versions from poetry.lock
  const lockMap = {};
  const poetry = rd(dir, 'poetry.lock');
  if (poetry) for (const blk of poetry.split('[[package]]').slice(1)) { const n = blk.match(/\bname\s*=\s*"([^"]+)"/); const v = blk.match(/\bversion\s*=\s*"([^"]+)"/); if (n && v) lockMap[n[1].toLowerCase()] = v[1]; }
  const pyproj = rd(dir, 'pyproject.toml');
  if (pyproj && poetry) { const sec = pyproj.split(/\[tool\.poetry\.dependencies\]/)[1]; if (sec) for (const m of sec.split(/\n\[/)[0].matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm)) { const n = m[1].toLowerCase(); if (n !== 'python' && lockMap[n]) c.add(`pypi://${n}:${lockMap[n]}`); } }
  // pipenv: direct = Pipfile [packages]/[dev-packages]; versions from Pipfile.lock
  const pip = rd(dir, 'Pipfile.lock'); const pipfile = rd(dir, 'Pipfile');
  if (pip && pipfile) { let d; try { d = JSON.parse(pip); } catch { d = null; } const ver = {}; if (d) for (const s of ['default', 'develop']) for (const [n, i] of Object.entries(d[s] || {})) ver[n.toLowerCase()] = (i.version || '').replace(/^==/, ''); for (const blk of ['packages', 'dev-packages']) { const sec = pipfile.split(new RegExp(`\\[${blk}\\]`))[1]; if (sec) for (const m of sec.split(/\n\[/)[0].matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm)) { const n = m[1].toLowerCase(); if (ver[n]) c.add(`pypi://${n}:${ver[n]}`); } } }
}
function goDirect(c, dir) {
  // go.mod require WITHOUT "// indirect" = direct deps (with exact versions)
  const mod = rd(dir, 'go.mod'); if (!mod) return;
  for (const m of mod.matchAll(/^\s*(?:require\s+)?([^\s()]+\.[^\s()]+\/?[^\s()]*)\s+(v[0-9][^\s]*)\s*(\/\/\s*indirect)?\s*$/gm))
    if (!m[3]) c.add(`go://${m[1]}:${m[2]}`);
}
function rubyDirect(c, dir) {
  // Gemfile.lock DEPENDENCIES section = direct gems; versions from GEM specs
  const lock = rd(dir, 'Gemfile.lock'); if (!lock) return;
  const ver = {}; for (const m of lock.matchAll(/^\s{4}([A-Za-z0-9_.-]+) \(([^)]+)\)/gm)) ver[m[1]] = m[2];
  const dep = lock.split(/^DEPENDENCIES$/m)[1]; if (!dep) return;
  for (const m of dep.split(/^\S/m)[0].matchAll(/^\s+([A-Za-z0-9_.-]+)/gm)) if (ver[m[1]]) c.add(`gem://${m[1]}:${ver[m[1]]}`);
}
function phpDirect(c, dir) {
  const cj = rd(dir, 'composer.json'); if (!cj) return; let d; try { d = JSON.parse(cj); } catch { return; }
  const ver = {}; const lock = rd(dir, 'composer.lock');
  if (lock) try { const l = JSON.parse(lock); for (const p of [...(l.packages || []), ...(l['packages-dev'] || [])]) ver[p.name] = (p.version || '').replace(/^v/, ''); } catch {}
  for (const sec of ['require', 'require-dev'])
    for (const [n, range] of Object.entries(d[sec] || {})) { if (n === 'php' || n.startsWith('ext-')) continue; const v = ver[n] || clean(range); if (isVer(v)) c.add(`composer://${n}:${v}`); }
}
function rustDirect(c, dir) {
  const toml = rd(dir, 'Cargo.toml'); if (!toml) return;
  const ver = {}; const lock = rd(dir, 'Cargo.lock');
  if (lock) for (const blk of lock.split('[[package]]').slice(1)) { const n = blk.match(/\bname\s*=\s*"([^"]+)"/); const v = blk.match(/\bversion\s*=\s*"([^"]+)"/); if (n && v) ver[n[1]] = v[1]; }
  for (const blk of ['dependencies', 'dev-dependencies', 'build-dependencies']) {
    const sec = toml.split(new RegExp(`\\[${blk}\\]`))[1]; if (!sec) continue;
    for (const line of sec.split(/\n\[/)[0].split('\n')) { const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/); if (!m) continue; const name = m[1]; const v = ver[name] || clean(m[2] || m[3]); if (isVer(v)) c.add(`cargo://${name}:${v}`); }
  }
}
function dartDirect(c, dir) {
  const yaml = rd(dir, 'pubspec.yaml'); if (!yaml) return;
  const ver = {}; const lock = rd(dir, 'pubspec.lock');
  if (lock) for (const m of lock.matchAll(/^  ([A-Za-z0-9_]+):\s*$[\s\S]*?^    version:\s*"?([^"\n]+)"?/gm)) ver[m[1]] = m[2].trim();
  for (const blk of ['dependencies', 'dev_dependencies']) {
    const sec = yaml.split(new RegExp(`^${blk}:`, 'm'))[1]; if (!sec) continue;
    for (const m of sec.split(/^\S/m)[0].matchAll(/^  ([A-Za-z0-9_]+):/gm)) { const n = m[1]; if (n !== 'flutter' && ver[n]) c.add(`pub://${n}:${ver[n]}`); }
  }
}
function swiftDirect(c, dir) { // Package.resolved is the resolved set; keep it (declaring direct needs Package.swift parsing)
  const txt = rd(dir, 'Package.resolved'); if (!txt) return; let d; try { d = JSON.parse(txt); } catch { return; }
  for (const p of d.pins || (d.object && d.object.pins) || []) { const loc = (p.location || p.repositoryURL || '').replace(/^https?:\/\//, '').replace(/\.git$/, ''); if (loc && p.state && p.state.version) c.add(`swift://${loc}:${p.state.version}`); }
}
function nugetDirect(c, dir) { // .csproj/.fsproj/.vbproj PackageReference = direct
  for (const f of ls(dir).filter((x) => x.endsWith('.csproj') || x.endsWith('.fsproj') || x.endsWith('.vbproj') || x.endsWith('.props') || x === 'packages.config')) {
    const txt = rd(dir, f); if (!txt) continue;
    // PackageReference / PackageVersion with Version as an attribute
    for (const m of txt.matchAll(/<Package(?:Reference|Version)\s+Include="([^"]+)"\s+Version="([^"]+)"/g)) c.add(`nuget://${m[1]}:${m[2]}`);
    // PackageReference with Version as a child element: <PackageReference Include="X"><Version>Y</Version>
    for (const m of txt.matchAll(/<PackageReference\s+Include="([^"]+)"[^>]*>\s*<Version>([^<]+)<\/Version>/g)) c.add(`nuget://${m[1]}:${m[2].trim()}`);
    // legacy packages.config
    for (const m of txt.matchAll(/<package\s+id="([^"]+)"\s+version="([^"]+)"/g)) c.add(`nuget://${m[1]}:${m[2]}`);
  }
}
function conanDirect(c, dir) {
  const cf = rd(dir, 'conanfile.txt'); if (cf) { const req = cf.split(/\[requires\]/)[1]; if (req) for (const m of req.split(/\n\[/)[0].matchAll(/^\s*([A-Za-z0-9_.+-]+)\/([0-9][^@#\s]*)/gm)) c.add(`conan://${m[1]}:${m[2]}`); }
}
function mavenDirect(c, dir) { // pom.xml direct <dependency> only (no transitive resolution)
  const txt = rd(dir, 'pom.xml'); if (!txt) return;
  const props = {}; const pv = txt.match(/<version>([^<$]+)<\/version>/); if (pv) props['project.version'] = pv[1].trim();
  for (const m of txt.matchAll(/<properties>([\s\S]*?)<\/properties>/g)) for (const p of m[1].matchAll(/<([A-Za-z0-9_.-]+)>([^<]+)<\/\1>/g)) props[p[1]] = p[2].trim();
  const resolve = (v) => v.replace(/\$\{([^}]+)\}/g, (_, k) => props[k] ?? '');
  for (const m of txt.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const b = m[1]; const g = b.match(/<groupId>([^<]+)<\/groupId>/); const a = b.match(/<artifactId>([^<]+)<\/artifactId>/); const v = b.match(/<version>([^<]+)<\/version>/);
    if (!g || !a || !v) continue; const ver = resolve(v[1].trim()); if (!ver || ver.includes('${')) continue;
    c.add(`gav://${g[1].trim()}:${a[1].trim()}:${ver}`);
  }
}
function gradleDirect(c, dir) { // build.gradle / version catalog literals = direct
  const cat = rd(dir, 'gradle/libs.versions.toml');
  if (cat) {
    const versions = {}; const vs = cat.split(/\[versions\]/)[1];
    if (vs) for (const m of vs.split(/\n\[/)[0].matchAll(/^\s*([\w.-]+)\s*=\s*"([^"]+)"/gm)) versions[m[1]] = m[2];
    const libs = cat.split(/\[libraries\]/)[1];
    if (libs) for (const line of libs.split(/\n\[/)[0].split('\n')) { const mod = line.match(/module\s*=\s*"([\w.-]+):([\w.-]+)"/); if (!mod) continue; const vref = line.match(/version\.ref\s*=\s*"([^"]+)"/); const vlit = line.match(/version\s*=\s*"([^"]+)"/); const ver = vref ? versions[vref[1]] : (vlit ? vlit[1] : null); if (ver) c.add(`gav://${mod[1]}:${mod[2]}:${ver}`); }
  }
  for (const f of ['build.gradle', 'build.gradle.kts']) { const txt = rd(dir, f); if (!txt) continue; for (const m of txt.matchAll(/['"]([\w.-]+):([\w.-]+):([\w.][\w.+-]*)['"]/g)) c.add(`gav://${m[1]}:${m[2]}:${m[3]}`); }
}

const PARSERS = [npmDirect, pyDirect, goDirect, rubyDirect, phpDirect, rustDirect, dartDirect, swiftDirect, nugetDirect, conanDirect, mavenDirect, gradleDirect];

function buildComponents() {
  const c = new Set();
  const dirs = findProjectDirs();
  console.error(`[jfrog-sca] scanning ${dirs.length} project dir(s) — DIRECT dependencies only`);
  for (const dir of dirs) for (const p of PARSERS) { try { p(c, dir); } catch (e) { console.error(`[jfrog-sca] ${p.name} @ ${dir}: ${e.message}`); } }
  return [...c];
}

// ── Xray scan/graph ───────────────────────────────────────────────────────────
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

// Honest error text for a definitive 4xx — these never fix themselves, so
// retrying them for ~4 min and then reporting a generic "timed out" hides the
// real cause (e.g. an expired token). The message lands in the tool status /
// Events via run-scans.sh (it greps stderr for error|forbidden|denied|…).
function http4xxError(where, status, statusText, body) {
  const hint = status === 401 ? ' — check the JFrog token (JF_ACCESS_TOKEN)'
    : status === 403 ? ' — token lacks Xray scan permissions (or access is forbidden/denied)'
    : status === 404 ? ' — Xray scan/graph API not found (check JF_URL)'
    : '';
  return new Error(`${where} error: HTTP ${status} ${statusText || ''}${hint}: ${(body || '').slice(0, 200)}`);
}

const POLL_ATTEMPTS = 80, POLL_INTERVAL_MS = 3000;
async function scanGraph(nodes) {
  const all = [];
  for (let off = 0; off < nodes.length; off += 4000) {
    const chunk = nodes.slice(off, off + 4000);
    const post = await fetch(`${URL}/xray/api/v1/scan/graph?include_vulnerabilities=true`, { method: 'POST', headers: H, body: JSON.stringify({ component_id: 'root', nodes: chunk.map((c) => ({ component_id: c })) }) });
    if (post.status >= 400 && post.status < 500) throw http4xxError('scan/graph POST', post.status, post.statusText, await post.text().catch(() => ''));
    if (!post.ok) throw new Error(`scan/graph POST failed: HTTP ${post.status} ${post.statusText || ''}: ${(await post.text().catch(() => '')).slice(0, 200)}`);
    const { scan_id } = await post.json();
    let got = null;
    let lastTransient = '';
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);
      let g;
      try {
        g = await fetch(`${URL}/xray/api/v1/scan/graph/${scan_id}?include_vulnerabilities=true&include_licenses=false`, { headers: H });
      } catch (e) { lastTransient = `network error: ${e.message}`; continue; } // network blip — retry
      // 4xx (401/403/404/…) is definitive — fail NOW with the honest cause
      // instead of burning the whole poll budget and lying "timed out".
      // 429 is the exception: a rate limit is genuinely transient.
      if (g.status >= 400 && g.status < 500 && g.status !== 429) throw http4xxError('scan/graph poll', g.status, g.statusText, await g.text().catch(() => ''));
      if (g.status !== 200) { lastTransient = `HTTP ${g.status} ${g.statusText || ''}`; continue; } // 5xx/429 — retry
      const d = await g.json();
      if (d.status === 'completed') { got = d.vulnerabilities || []; break; }
      lastTransient = `scan status "${d.status}"`; // genuine pending — keep waiting
    }
    if (got === null) throw new Error(`scan/graph timed out after ${Math.round(POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000)}s (last state: ${lastTransient || 'no response'})`);
    all.push(...got);
  }
  return all;
}

const SEV = { Critical: 'error', High: 'error', Medium: 'warning', Low: 'note', Unknown: 'note' };
function toSarif(vulns) {
  const rules = new Map(); const results = [];
  for (const v of vulns) {
    const cve = (v.cves && v.cves[0] && v.cves[0].cve) || v.issue_id || 'UNKNOWN';
    const comp = Object.keys(v.components || {})[0] || '';
    const ruleId = `${cve}:${comp}`;
    if (!rules.has(ruleId)) rules.set(ruleId, { id: ruleId, name: cve, shortDescription: { text: (v.summary || cve).slice(0, 200) }, properties: { security_severity: String(v.cvss_v3_score ?? ''), severity: v.severity, tags: ['security', 'sca', 'jfrog-xray'] } });
    results.push({ ruleId, level: SEV[v.severity] || 'warning', message: { text: `${cve} in ${comp} (${v.severity}) — ${(v.summary || '').slice(0, 300)}` }, locations: [{ physicalLocation: { artifactLocation: { uri: 'dependencies' } } }], properties: { component: comp, severity: v.severity, fixedVersions: (v.components?.[comp]?.fixed_versions) || [] } });
  }
  return { version: '2.1.0', $schema: 'https://json.schemastore.org/sarif-2.1.0.json', runs: [{ tool: { driver: { name: 'JFrog Xray', rules: [...rules.values()] } }, results }] };
}

(async () => {
  const nodes = buildComponents();
  console.error(`[jfrog-sca] ${nodes.length} direct components`);
  if (process.env.JF_COMPS_OUT) fs.writeFileSync(process.env.JF_COMPS_OUT, JSON.stringify(nodes));
  if (nodes.length === 0) { fs.writeFileSync(OUT, JSON.stringify(toSarif([]))); console.error('[jfrog-sca] no direct dependencies found — empty SARIF'); return; }
  const vulns = await scanGraph(nodes);
  fs.writeFileSync(OUT, JSON.stringify(toSarif(vulns)));
  console.error(`[jfrog-sca] ${vulns.length} vulnerabilities → ${OUT}`);
})().catch((e) => { console.error(`[jfrog-sca] ERROR: ${e.message}`); process.exit(1); });
