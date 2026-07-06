/**
 * Pure duplicate-contributor detection for the merge suggestions panel.
 *
 * Conservative signals only — false positives are expensive (a human might
 * merge two real people), so every rule errs on the side of NOT matching.
 * No network calls: operates on the contributor list the page already has.
 */

/** Minimal structural shape needed for detection (subset of Contributor). */
export interface MergeCandidateContributor {
  id: number;
  displayName: string;
  emails: string[];
}

export type MergeCandidateReason = 'sameName' | 'sameEmailLocal' | 'initialPattern';

export interface MergeCandidateGroup<
  C extends MergeCandidateContributor = MergeCandidateContributor,
> {
  /** Stable id (reason + sorted member ids) — used for session-only dismissal. */
  id: string;
  reason: MergeCandidateReason;
  members: C[];
}

/** Names / email local-parts too generic to be an identity signal. */
const GENERIC_NAMES = new Set([
  'admin', 'administrator', 'root', 'test', 'tests', 'user', 'guest',
  'bot', 'ci', 'cd', 'build', 'deploy', 'release', 'dev', 'devops',
  'developer', 'unknown', 'anonymous', 'noreply', 'no-reply', 'nobody',
  'support', 'info', 'contact', 'mail', 'email', 'git', 'github',
  'gitlab', 'jenkins', 'travis', 'automation', 'service', 'system',
]);

/** Lowercase, strip diacritics, collapse whitespace. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Obviously generic names carry no identity signal:
 * - names under 3 chars
 * - single-word lowercase names (e.g. "admin", "ci") or known generic words
 */
function isGenericName(raw: string): boolean {
  const normalized = normalizeName(raw);
  if (normalized.length < 3) return true;
  if (!normalized.includes(' ')) {
    if (GENERIC_NAMES.has(normalized)) return true;
    const trimmed = raw.trim();
    if (trimmed === trimmed.toLowerCase()) return true; // single-word lowercase
  }
  return false;
}

function splitEmail(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return {
    local: email.slice(0, at).toLowerCase().trim(),
    domain: email.slice(at + 1).toLowerCase().trim(),
  };
}

/** Local-parts that are too short or generic to identify a person. */
function isUsableLocal(local: string): boolean {
  return local.length >= 3 && !GENERIC_NAMES.has(local);
}

/**
 * Initial-pattern match between two email local-parts:
 * "b.kesarev" vs "boris.kesarev" — same surname, single-letter first token
 * matching the first letter of the other's first name. Exactly two tokens
 * each (separated by . _ or -) to stay conservative.
 */
function matchesInitialPattern(localA: string, localB: string): boolean {
  const a = localA.split(/[._-]/).filter(Boolean);
  const b = localB.split(/[._-]/).filter(Boolean);
  if (a.length !== 2 || b.length !== 2) return false;
  const [firstA, lastA] = a;
  const [firstB, lastB] = b;
  if (lastA !== lastB) return false;
  if (lastA.length < 3 || GENERIC_NAMES.has(lastA)) return false;
  // One side is a bare initial, the other a longer first name starting with it
  if (firstA.length === 1 && firstB.length >= 2) return firstB[0] === firstA;
  if (firstB.length === 1 && firstA.length >= 2) return firstA[0] === firstB;
  return false;
}

/**
 * Find groups of contributors that are likely the same person.
 * Signals (each group is tagged with the `reason` that produced it):
 *  - sameName: identical normalized display name
 *  - sameEmailLocal: identical email local-part on different domains
 *  - initialPattern: "b.kesarev" vs "boris.kesarev" style local-parts
 */
export function findMergeCandidates<C extends MergeCandidateContributor>(
  contributors: readonly C[],
): MergeCandidateGroup<C>[] {
  const groups: MergeCandidateGroup<C>[] = [];
  const seenMemberSets: Set<number>[] = [];

  const pushGroup = (reason: MergeCandidateReason, members: C[]) => {
    const idSet = new Set(members.map((m) => m.id));
    // Skip if these members are already covered together by an earlier group
    const covered = seenMemberSets.some(
      (s) => idSet.size <= s.size && [...idSet].every((id) => s.has(id)),
    );
    if (covered) return;
    seenMemberSets.push(idSet);
    const sortedIds = [...idSet].sort((x, y) => x - y).join('-');
    groups.push({ id: `${reason}:${sortedIds}`, reason, members });
  };

  // ── (a) identical normalized display name ────────────────────────
  const byName = new Map<string, C[]>();
  for (const c of contributors) {
    if (isGenericName(c.displayName)) continue;
    const key = normalizeName(c.displayName);
    const bucket = byName.get(key);
    if (bucket) bucket.push(c); else byName.set(key, [c]);
  }
  for (const bucket of byName.values()) {
    if (bucket.length >= 2) pushGroup('sameName', bucket);
  }

  // ── (b) identical email local-part across different domains ─────
  const byLocal = new Map<string, { contributor: C; domain: string }[]>();
  for (const c of contributors) {
    const seenLocals = new Set<string>();
    for (const email of c.emails) {
      const parts = splitEmail(email);
      if (!parts || !isUsableLocal(parts.local)) continue;
      if (seenLocals.has(parts.local)) continue; // one entry per contributor+local
      seenLocals.add(parts.local);
      const bucket = byLocal.get(parts.local);
      const entry = { contributor: c, domain: parts.domain };
      if (bucket) bucket.push(entry); else byLocal.set(parts.local, [entry]);
    }
  }
  for (const bucket of byLocal.values()) {
    const uniqueIds = new Set(bucket.map((e) => e.contributor.id));
    const uniqueDomains = new Set(bucket.map((e) => e.domain));
    if (uniqueIds.size >= 2 && uniqueDomains.size >= 2) {
      const members: C[] = [];
      for (const e of bucket) {
        if (!members.includes(e.contributor)) members.push(e.contributor);
      }
      pushGroup('sameEmailLocal', members);
    }
  }

  // ── (c) initial-pattern local-parts, pairwise ────────────────────
  const locals: { contributor: C; local: string }[] = [];
  for (const c of contributors) {
    for (const email of c.emails) {
      const parts = splitEmail(email);
      if (parts && isUsableLocal(parts.local)) {
        locals.push({ contributor: c, local: parts.local });
      }
    }
  }
  for (let i = 0; i < locals.length; i++) {
    for (let j = i + 1; j < locals.length; j++) {
      const a = locals[i];
      const b = locals[j];
      if (a.contributor.id === b.contributor.id) continue;
      if (matchesInitialPattern(a.local, b.local)) {
        pushGroup('initialPattern', [a.contributor, b.contributor]);
      }
    }
  }

  return groups;
}
