import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { discoverRepos } from './repo-discovery.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'beast-discovery-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Create a tree from a flat list of paths. Trailing "/" means directory. */
function tree(...paths: string[]) {
  for (const p of paths) {
    const full = join(root, p);
    if (p.endsWith('/')) {
      mkdirSync(full, { recursive: true });
    } else {
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, 'x');
    }
  }
}

const names = (r: { repos: { name: string }[] }) => r.repos.map((x) => x.name).sort();

describe('discoverRepos', () => {
  describe('files at the root mean a single repository', () => {
    it('treats a project laid out at the archive root as one repo named after the archive', () => {
      // The real setup.zip shape: loose entrypoints + a package dir + build junk.
      tree('run.py', 'setup.py', 'requirements.txt', 'README.md',
        'cmpacking/app.py', '__pycache__/run.cpython-313.pyc');

      const result = discoverRepos(root, 'setup');

      expect(result.layout).toBe('single');
      expect(result.repos).toEqual([{ name: 'setup', path: root }]);
    });

    it('keeps a single repo even when most of the tree is directories', () => {
      tree('Makefile', 'src/main.c', 'include/main.h', 'docs/readme.md');

      const result = discoverRepos(root, 'kernel');

      expect(result.layout).toBe('single');
      expect(result.repos).toEqual([{ name: 'kernel', path: root }]);
    });
  });

  describe('only directories at the root mean several repositories', () => {
    it('makes one repo per top-level directory', () => {
      tree('api/package.json', 'web/package.json', 'infra/main.tf');

      const result = discoverRepos(root, 'projects');

      expect(result.layout).toBe('multi');
      expect(names(result)).toEqual(['api', 'infra', 'web']);
    });

    it('strips branch suffixes from directory names', () => {
      tree('api-main/package.json', 'web-develop/package.json');

      expect(names(discoverRepos(root, 'projects'))).toEqual(['api', 'web']);
    });
  });

  describe('noise files must not flip the decision to single', () => {
    it.each(['.DS_Store', 'Thumbs.db', 'desktop.ini', '._run.py', '.gitignore~', '.main.c.swp'])(
      'ignores %s at the root',
      (noise) => {
        tree('api/package.json', 'web/package.json', noise);

        const result = discoverRepos(root, 'projects');

        expect(result.layout).toBe('multi');
        expect(names(result)).toEqual(['api', 'web']);
        expect(result.skipped).toContain(noise);
      },
    );

    it('reports a real file as meaningful even when its name is unknown', () => {
      // Fail-safe direction: an unrecognised file must produce ONE repo that
      // scans everything, never several repos with the root files dropped.
      tree('api/package.json', 'web/package.json', 'deploy.cmd');

      const result = discoverRepos(root, 'projects');

      expect(result.layout).toBe('single');
      expect(result.repos).toEqual([{ name: 'projects', path: root }]);
    });
  });

  describe('junk directories are never repositories', () => {
    it.each(['node_modules', '__pycache__', '.idea', '.venv', '__MACOSX'])(
      'skips %s next to real projects',
      (junk) => {
        tree('api/package.json', 'web/package.json', `${junk}/whatever.txt`);

        const result = discoverRepos(root, 'projects');

        expect(names(result)).toEqual(['api', 'web']);
        expect(result.skipped).toContain(junk);
      },
    );
  });

  describe('nesting', () => {
    it('unwraps an archive that wraps everything in one directory', () => {
      tree('cmpacking-setup/setup.py', 'cmpacking-setup/cmpacking/app.py');

      const result = discoverRepos(root, 'setup');

      expect(result.layout).toBe('single');
      expect(result.repos).toEqual([
        { name: 'cmpacking-setup', path: join(root, 'cmpacking-setup') },
      ]);
    });

    it('descends through grouping directories to find the real projects', () => {
      tree('teamA/api/package.json', 'teamA/web/package.json', 'teamB/infra/main.tf');

      const result = discoverRepos(root, 'all-teams');

      expect(result.layout).toBe('multi');
      expect(names(result)).toEqual(['api', 'infra', 'web']);
    });

    it('stops descending at a directory holding .git even if it has no loose files', () => {
      tree('checkout/.git/HEAD', 'checkout/src/main.go');

      const result = discoverRepos(root, 'clone');

      expect(result.repos).toEqual([{ name: 'checkout', path: join(root, 'checkout') }]);
    });

    it('ignores empty directories instead of importing empty repos', () => {
      tree('api/package.json', 'leftovers/');

      expect(names(discoverRepos(root, 'projects'))).toEqual(['api']);
    });
  });

  describe('name collisions', () => {
    it('disambiguates equal directory names by their path instead of overwriting', () => {
      tree('teamA/api/package.json', 'teamB/api/package.json');

      const result = discoverRepos(root, 'all-teams');

      expect(names(result)).toEqual(['teamA-api', 'teamB-api']);
    });
  });

  describe('nothing to scan must scream', () => {
    it('throws when the archive is empty', () => {
      expect(() => discoverRepos(root, 'empty'))
        .toThrow(/no scannable content/i);
    });

    it('throws when the archive holds nothing but junk', () => {
      tree('__MACOSX/._x', '.DS_Store');

      expect(() => discoverRepos(root, 'junk'))
        .toThrow(/no scannable content/i);
    });
  });
});
