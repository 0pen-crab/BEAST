import { describe, it, expect } from 'vitest';
import { canManageWorkspace, canManageMembers, isSuperAdmin, canWrite } from './permissions';

describe('permissions', () => {
  it('isSuperAdmin returns true for super_admin role', () => {
    expect(isSuperAdmin('super_admin')).toBe(true);
    expect(isSuperAdmin('user')).toBe(false);
  });

  it('canWrite returns true for super_admin', () => {
    expect(canWrite('super_admin', undefined)).toBe(true);
  });

  it('canWrite returns true for workspace_admin', () => {
    expect(canWrite('user', 'workspace_admin')).toBe(true);
  });

  it('canWrite returns false for member', () => {
    expect(canWrite('user', 'member')).toBe(false);
  });

  it('canManageMembers returns true for workspace_admin and super_admin', () => {
    expect(canManageMembers('super_admin', undefined)).toBe(true);
    expect(canManageMembers('user', 'workspace_admin')).toBe(true);
    expect(canManageMembers('user', 'member')).toBe(false);
  });
});
