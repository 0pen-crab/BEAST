import { describe, it, expect, vi } from 'vitest';

vi.mock('../orchestrator/entities.ts');
vi.mock('../middleware/auth.ts', () => ({
  requireRole: () => async () => {},
}));

describe('admin routes', () => {
  it('exports adminRoutes plugin', async () => {
    const { adminRoutes } = await import('./admin.ts');
    expect(adminRoutes).toBeDefined();
    expect(typeof adminRoutes).toBe('function');
  });
});
