import { useAuth } from './auth';
import { useWorkspace } from './workspace';
import { useWorkspaceMembers } from '@/api/hooks';

export function isSuperAdmin(globalRole: string): boolean {
  return globalRole === 'super_admin';
}

export function canWrite(globalRole: string, workspaceRole: string | undefined): boolean {
  if (globalRole === 'super_admin') return true;
  return workspaceRole === 'workspace_admin';
}

export function canManageMembers(globalRole: string, workspaceRole: string | undefined): boolean {
  if (globalRole === 'super_admin') return true;
  return workspaceRole === 'workspace_admin';
}

export function canManageWorkspace(globalRole: string): boolean {
  return globalRole === 'super_admin';
}

export function useCurrentWorkspaceRole(): 'super_admin' | 'workspace_admin' | 'member' | null {
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const { data: members } = useWorkspaceMembers(currentWorkspace?.id);

  if (!user) return null;
  if (user.role === 'super_admin') return 'super_admin';
  if (!members) return null;

  const membership = members.find(m => m.userId === user.id);
  return (membership?.role as 'workspace_admin' | 'member') ?? null;
}
