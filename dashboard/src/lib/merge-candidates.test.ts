import { describe, it, expect } from 'vitest';
import { findMergeCandidates } from './merge-candidates';
import type { MergeCandidateContributor } from './merge-candidates';

let nextId = 1;
function make(displayName: string, emails: string[]): MergeCandidateContributor {
  return { id: nextId++, displayName, emails };
}

describe('findMergeCandidates', () => {
  it('returns empty array for empty input', () => {
    expect(findMergeCandidates([])).toEqual([]);
  });

  it('returns empty array when there are no duplicates', () => {
    const list = [
      make('David Malko', ['david.malko@a.com']),
      make('Olena Shevchenko', ['olena.shevchenko@a.com']),
    ];
    expect(findMergeCandidates(list)).toEqual([]);
  });

  // ── (a) identical normalized displayName ─────────────────────────

  it('groups contributors with identical names ignoring case and spacing', () => {
    const a = make('David Malko', ['dmalko@a.com']);
    const b = make('david   MALKO ', ['david@b.com']);
    const groups = findMergeCandidates([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('sameName');
    expect(groups[0].members.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('groups contributors with identical names ignoring diacritics', () => {
    const a = make('Dávid Malkó', ['x@a.com']);
    const b = make('David Malko', ['y@b.com']);
    const groups = findMergeCandidates([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('sameName');
  });

  it('groups three contributors with the same name into one group', () => {
    const a = make('David Malko', ['1@a.com']);
    const b = make('David Malko', ['2@b.com']);
    const c = make('david malko', ['3@c.com']);
    const groups = findMergeCandidates([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
  });

  it('does NOT group different people who merely share a surname', () => {
    const a = make('Boris Kesarev', ['boris@a.com']);
    const b = make('Ivan Kesarev', ['ivan@a.com']);
    expect(findMergeCandidates([a, b])).toEqual([]);
  });

  it('skips generic single-word lowercase names like admin/root/test', () => {
    const list = [
      make('admin', ['admin@a.com']),
      make('admin', ['admin@b.io']),
      make('root', ['r1@a.com']),
      make('root', ['r2@b.com']),
      make('test', ['t1@a.com']),
      make('test', ['t2@b.com']),
    ];
    expect(findMergeCandidates(list)).toEqual([]);
  });

  it('skips names shorter than 3 characters', () => {
    const a = make('ab', ['ab-one@a.com']);
    const b = make('ab', ['ab-two@b.com']);
    expect(findMergeCandidates([a, b])).toEqual([]);
  });

  it('still matches capitalized multi-word names containing a generic word', () => {
    const a = make('Test Petrenko', ['first@a.com']);
    const b = make('Test Petrenko', ['second@b.com']);
    const groups = findMergeCandidates([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('sameName');
  });

  // ── (b) identical email local-part on different domains ─────────

  it('groups identical email local-parts across different domains', () => {
    const a = make('Boris K', ['boris.kesarev@companya.com']);
    const b = make('Kesarev Boris', ['boris.kesarev@companyb.io']);
    const groups = findMergeCandidates([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('sameEmailLocal');
    expect(groups[0].members.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('does NOT group identical local-parts on the SAME domain', () => {
    // Same full email on two contributors is a data issue, not our conservative signal
    const a = make('Person One', ['shared@corp.com']);
    const b = make('Person Two', ['shared@corp.com']);
    expect(findMergeCandidates([a, b])).toEqual([]);
  });

  it('does NOT group generic email local-parts like admin@ or info@', () => {
    const a = make('Alice Wonder', ['admin@a.com']);
    const b = make('Bob Builder', ['admin@b.com']);
    expect(findMergeCandidates([a, b])).toEqual([]);
  });

  it('does NOT group email local-parts shorter than 3 characters', () => {
    const a = make('Alice Wonder', ['bk@a.com']);
    const b = make('Bob Builder', ['bk@b.com']);
    expect(findMergeCandidates([a, b])).toEqual([]);
  });

  // ── (c) initial-pattern local-parts ──────────────────────────────

  it('pairs "b.kesarev" with "boris.kesarev" (initial + same surname)', () => {
    const a = make('B. Kesarev', ['b.kesarev@corp.com']);
    const b = make('Boris Kesarev', ['boris.kesarev@corp.com']);
    const groups = findMergeCandidates([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('initialPattern');
    expect(groups[0].members.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('does NOT pair initials that do not match the first name', () => {
    // v. != boris — different person, same surname
    const a = make('V. Kesarev', ['v.kesarev@corp.com']);
    const b = make('Boris Kesarev', ['boris.kesarev@corp.com']);
    expect(findMergeCandidates([a, b])).toEqual([]);
  });

  it('does NOT pair different surnames even with matching initial', () => {
    const a = make('B. Malko', ['b.malko@corp.com']);
    const b = make('Boris Kesarev', ['boris.kesarev@corp.com']);
    expect(findMergeCandidates([a, b])).toEqual([]);
  });

  it('does NOT pair two full first-name local-parts with same surname', () => {
    const a = make('Boris Kesarev', ['boris.kesarev@corp.com']);
    const b = make('Ivan Kesarev', ['ivan.kesarev@corp.com']);
    expect(findMergeCandidates([a, b])).toEqual([]);
  });

  // ── general behavior ─────────────────────────────────────────────

  it('deduplicates a pair matched by multiple signals (name wins)', () => {
    const a = make('David Malko', ['david.malko@a.com']);
    const b = make('David Malko', ['david.malko@b.com']);
    const groups = findMergeCandidates([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('sameName');
  });

  it('assigns a stable unique id to each group', () => {
    const a = make('David Malko', ['1@a.com']);
    const b = make('David Malko', ['2@b.com']);
    const first = findMergeCandidates([a, b]);
    const second = findMergeCandidates([a, b]);
    expect(first[0].id).toBe(second[0].id);
    expect(typeof first[0].id).toBe('string');
    expect(first[0].id.length).toBeGreaterThan(0);
  });

  it('can return multiple independent groups', () => {
    const a = make('David Malko', ['1@a.com']);
    const b = make('David Malko', ['2@b.com']);
    const c = make('Anna Koval', ['anna.koval@x.com']);
    const d = make('A Koval', ['anna.koval@y.com']);
    const groups = findMergeCandidates([a, b, c, d]);
    expect(groups).toHaveLength(2);
    const reasons = groups.map((g) => g.reason).sort();
    expect(reasons).toEqual(['sameEmailLocal', 'sameName']);
  });

  it('does not mutate the input array', () => {
    const a = make('David Malko', ['1@a.com']);
    const b = make('David Malko', ['2@b.com']);
    const input = [a, b];
    const snapshot = JSON.parse(JSON.stringify(input));
    findMergeCandidates(input);
    expect(input).toEqual(snapshot);
  });

  it('handles contributors with no emails without crashing', () => {
    const a = make('David Malko', []);
    const b = make('David Malko', ['x@a.com']);
    const groups = findMergeCandidates([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('sameName');
  });
});
