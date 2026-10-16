import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspace } from '@/lib/workspace';
import { useAuth } from '@/lib/auth';
import { canManageMembers } from '@/lib/permissions';
import {
  useWorkspaceMembers,
  useAddWorkspaceMember,
  useUpdateWorkspaceMember,
  useRemoveWorkspaceMember,
} from '@/api/hooks';
import type { WorkspaceMember, WorkspaceUserOption } from '@/api/types';
import { formatDate } from '@/lib/format';
import { ErrorBoundary } from '@/components/error-boundary';
import { TableSkeleton } from '@/components/skeleton';
import { UserSearch } from '@/components/user-search';

export function MembersPage() {
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();
  const { user } = useAuth();

  const { data: members, isLoading } = useWorkspaceMembers(currentWorkspace?.id);

  const currentMember = members?.find((m) => m.userId === user?.id);
  const canManage = user
    ? canManageMembers(user.role, currentMember?.role)
    : false;

  return (
    <ErrorBoundary>
      <div className="beast-stack-md">
        <div className="beast-page-header">
          <div>
            <h1 className="beast-page-title">{t('members.title')}</h1>
          </div>
        </div>

        {canManage && currentWorkspace && (
          <AddMemberForm workspaceId={currentWorkspace.id} />
        )}

        <div className="beast-table-wrap">
          {isLoading ? (
            <div className="beast-section-pad"><TableSkeleton rows={5} /></div>
          ) : !members || members.length === 0 ? (
            <div className="beast-empty">{t('members.noMembers')}</div>
          ) : (
            <table className="beast-table">
              <thead>
                <tr>
                  <th>{t('members.username')}</th>
                  <th>{t('members.displayName')}</th>
                  <th>{t('members.role')}</th>
                  <th>{t('members.addedAt')}</th>
                  {canManage && <th>{t('members.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    canManage={canManage}
                    isSelf={member.userId === user?.id}
                    workspaceId={currentWorkspace?.id ?? 0}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}

function AddMemberForm({ workspaceId }: { workspaceId: number }) {
  const { t } = useTranslation();
  const addMutation = useAddWorkspaceMember();
  const [selectedUser, setSelectedUser] = useState<WorkspaceUserOption | null>(null);
  const [role, setRole] = useState<string>('member');
  const [error, setError] = useState('');

  async function handleAdd() {
    if (!selectedUser) return;
    setError('');

    try {
      await addMutation.mutateAsync({ workspaceId, username: selectedUser.username, role });
      setSelectedUser(null);
    } catch (err: any) {
      setError(err.message || t('common.error'));
    }
  }

  return (
    <div className="beast-stack">
      <div className="beast-inline-form">
        {selectedUser ? (
          <span className="beast-selected-user">
            <span className="beast-selected-user-label">
              {selectedUser.username}
            </span>
            <button
              type="button"
              className="beast-selected-user-clear"
              onClick={() => setSelectedUser(null)}
              aria-label={t('members.clearSelection')}
            >
              &times;
            </button>
          </span>
        ) : (
          <UserSearch workspaceId={workspaceId} onSelect={setSelectedUser} />
        )}
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="beast-select"
        >
          <option value="member">{t('members.member')}</option>
          <option value="workspace_admin">{t('members.workspaceAdmin')}</option>
        </select>
        <button
          onClick={handleAdd}
          disabled={!selectedUser || addMutation.isPending}
          className="beast-btn beast-btn-primary"
        >
          {addMutation.isPending ? t('common.loading') : t('members.addMember')}
        </button>
      </div>

      {error && <div className="beast-error">{error}</div>}
    </div>
  );
}

function MemberRow({
  member,
  canManage,
  isSelf,
  workspaceId,
}: {
  member: WorkspaceMember;
  canManage: boolean;
  isSelf: boolean;
  workspaceId: number;
}) {
  const { t } = useTranslation();
  const updateMutation = useUpdateWorkspaceMember();
  const removeMutation = useRemoveWorkspaceMember();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  function handleRoleChange(newRole: string) {
    updateMutation.mutate({ workspaceId, userId: member.userId, role: newRole });
  }

  function handleRemove() {
    removeMutation.mutate(
      { workspaceId, userId: member.userId },
      { onSuccess: () => setConfirmingRemove(false) },
    );
  }

  return (
    <tr>
      <td className="beast-td-primary">{member.username}</td>
      <td>{member.displayName ?? '\u2014'}</td>
      <td>
        {canManage ? (
          <select
            value={member.role}
            onChange={(e) => handleRoleChange(e.target.value)}
            disabled={updateMutation.isPending}
            aria-label={t('members.changeRole')}
            className="beast-select beast-select-sm"
          >
            <option value="workspace_admin">{t('members.workspaceAdmin')}</option>
            <option value="member">{t('members.member')}</option>
          </select>
        ) : (
          <RoleBadge role={member.role} />
        )}
      </td>
      <td className="beast-td-date">{formatDate(member.createdAt)}</td>
      {canManage && (
        <td>
          {isSelf ? null : confirmingRemove ? (
            <span className="beast-inline-confirm">
              <span>{t('members.confirmRemove')}</span>
              <button onClick={handleRemove} className="beast-btn beast-btn-danger beast-btn-sm">
                {t('members.yes')}
              </button>
              <button onClick={() => setConfirmingRemove(false)} className="beast-btn beast-btn-outline beast-btn-sm">
                {t('members.no')}
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmingRemove(true)}
              className="beast-btn beast-btn-danger beast-btn-sm"
            >
              {t('members.remove')}
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation();
  const label = role === 'workspace_admin' ? t('members.workspaceAdmin') : t('members.member');
  const cls = role === 'workspace_admin' ? 'beast-badge-red' : 'beast-badge-gray';
  return <span className={`beast-badge ${cls}`}>{label}</span>;
}
