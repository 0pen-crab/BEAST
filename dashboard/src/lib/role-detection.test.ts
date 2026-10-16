import { describe, it, expect } from 'vitest';
import { detectRole, type RoleResult } from './role-detection';

describe('detectRole', () => {
  it('returns unknown for empty input', () => {
    const result = detectRole({});
    expect(result.role).toBe('Unknown');
  });

  it('detects frontend engineer', () => {
    const result = detectRole({ '.tsx': 100, '.css': 50, '.html': 20 });
    expect(result.role).toBe('Frontend Engineer');
  });

  it('detects backend engineer', () => {
    const result = detectRole({ '.go': 80, '.sql': 20 });
    expect(result.role).toBe('Backend Engineer');
  });

  it('detects fullstack when both frontend and backend are significant', () => {
    const result = detectRole({ '.tsx': 60, '.css': 30, '.go': 50, '.sql': 10 });
    expect(result.role).toBe('Fullstack Engineer');
  });

  it('detects devops engineer', () => {
    const result = detectRole({ '.yml': 40, '.tf': 30, '.sh': 20, '.dockerfile': 10 });
    expect(result.role).toBe('DevOps Engineer');
  });

  it('detects mobile developer from swift files', () => {
    const result = detectRole({ '.swift': 80, '.storyboard': 10 });
    expect(result.role).toBe('Mobile Engineer');
  });

  it('detects mobile developer from dart files', () => {
    const result = detectRole({ '.dart': 100 });
    expect(result.role).toBe('Mobile Engineer');
  });

  it('detects data engineer', () => {
    const result = detectRole({ '.sql': 60, '.py': 20, '.csv': 10 });
    expect(result.role).toBe('Data Engineer');
  });

  it('detects ML engineer', () => {
    const result = detectRole({ '.ipynb': 50, '.py': 40 });
    expect(result.role).toBe('ML Engineer');
  });

  it('detects embedded/systems engineer', () => {
    const result = detectRole({ '.c': 80, '.h': 40, '.asm': 10 });
    expect(result.role).toBe('Systems Engineer');
  });

  it('detects game developer', () => {
    const result = detectRole({ '.cs': 50, '.unity': 20, '.shader': 15, '.hlsl': 10 });
    expect(result.role).toBe('Game Developer');
  });

  it('detects QA engineer', () => {
    const result = detectRole({ '.feature': 30, '.robot': 20, '.spec.ts': 15 });
    expect(result.role).toBe('QA Engineer');
  });

  it('detects technical writer', () => {
    const result = detectRole({ '.md': 80, '.mdx': 20, '.rst': 10 });
    expect(result.role).toBe('Tech Writer');
  });

  it('returns confidence score between 0 and 1', () => {
    const result = detectRole({ '.tsx': 100, '.css': 50 });
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('returns top roles sorted by score', () => {
    const result = detectRole({ '.tsx': 60, '.css': 30, '.go': 20 });
    expect(result.topRoles.length).toBeGreaterThan(0);
    for (let i = 1; i < result.topRoles.length; i++) {
      expect(result.topRoles[i].score).toBeLessThanOrEqual(result.topRoles[i - 1].score);
    }
  });

  it('handles ambiguous extensions like .ts by context', () => {
    const frontend = detectRole({ '.ts': 50, '.html': 30, '.scss': 20 });
    expect(frontend.role).toBe('Frontend Engineer');

    const backend = detectRole({ '.ts': 50, '.sql': 20, '.prisma': 10 });
    expect(backend.role).toBe('Backend Engineer');
  });

  it('handles .py ambiguity — backend vs data vs ML', () => {
    const data = detectRole({ '.py': 40, '.sql': 40, '.csv': 10 });
    expect(data.role).toBe('Data Engineer');

    const ml = detectRole({ '.py': 40, '.ipynb': 30 });
    expect(ml.role).toBe('ML Engineer');

    const backend = detectRole({ '.py': 80 });
    expect(backend.role).toBe('Backend Engineer');
  });
});
