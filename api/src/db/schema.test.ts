import { describe, it, expect } from 'vitest';
import * as schema from './schema.ts';

describe('schema', () => {
  it('exports workspaceMembers table', () => {
    expect(schema.workspaceMembers).toBeDefined();
  });

  it('exports WorkspaceMember and NewWorkspaceMember types', () => {
    // Type-level check — if this compiles, types exist
    const _select: schema.WorkspaceMember | undefined = undefined;
    const _insert: schema.NewWorkspaceMember | undefined = undefined;
    expect(true).toBe(true);
  });

  it('exports secrets and secretRefs tables', () => {
    expect(schema.secrets).toBeDefined();
    expect(schema.secretRefs).toBeDefined();
  });

  it('exports Secret and SecretRef types', () => {
    const _secret: schema.Secret | undefined = undefined;
    const _secretRef: schema.SecretRef | undefined = undefined;
    expect(true).toBe(true);
  });

  it('does not export sourceCredentials', () => {
    expect((schema as any).sourceCredentials).toBeUndefined();
  });

  it('sources table has credentialType and credentialUsername columns', () => {
    // Drizzle tables have a property for each column
    expect((schema.sources as any).credentialType).toBeDefined();
    expect((schema.sources as any).credentialUsername).toBeDefined();
  });

  it('workspaces table does not have jfrogUrl column', () => {
    expect((schema.workspaces as any).jfrogUrl).toBeUndefined();
  });

  it('workspaceTools table is defined', () => {
    expect(schema.workspaceTools).toBeDefined();
  });
});
