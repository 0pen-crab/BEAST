import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { shellQuote } from './shell.ts';

/** What bash actually receives as a single argument. */
function throughBash(value: string): string {
  return execFileSync('bash', ['-c', `printf %s ${shellQuote(value)}`], { encoding: 'utf8' });
}

describe('shellQuote', () => {
  const hostile = [
    'plain/path',
    'repo with spaces',
    'a$(touch PWNED)b',
    'a`touch PWNED`b',
    'it\'s "quoted"',
    'semi;colon && rm -rf x | pipe',
    '$HOME ${PATH} \\n * ? [a]',
    '-rf',
    '',
    'line\nbreak',
  ];

  for (const value of hostile) {
    it(`passes ${JSON.stringify(value)} through bash unchanged`, () => {
      expect(throughBash(value)).toBe(value);
    });
  }
});
