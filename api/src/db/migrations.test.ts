import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The drizzle migrator runs only what meta/_journal.json lists. A .sql file
// left out of the journal is silently skipped, so a fresh install boots with
// a schema the code does not match.
const MIGRATIONS_DIR = path.resolve(__dirname, '../../drizzle');

const journal = JSON.parse(
  fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
) as { entries: { idx: number; when: number; tag: string }[] };

describe('drizzle migrations', () => {
  it('every .sql file is listed in the journal', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''))
      .sort();
    expect(journal.entries.map((e) => e.tag)).toEqual(files);
  });

  it('journal entries are numbered and timestamped in order', () => {
    journal.entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      if (i > 0) expect(entry.when).toBeGreaterThan(journal.entries[i - 1].when);
    });
  });
});
