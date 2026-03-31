import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  useAdminUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
} from '@/api/hooks';
import { formatDate } from '@/lib/format';
import type { AdminUser } from '@/api/types';

// ── Modal component ──────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="beast-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="beast-modal">
        <div className="flex items-center justify-between beast-mb-md">
          <h3 className="beast-modal-title">{title}</h3>
          <button
            onClick={onClose}
            className="beast-btn beast-btn-ghost"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Password reveal dialog ────────────────────────────────────────

function PasswordDialog({
  password,
  title,
  onClose,
}: {
  password: string;
  title: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p className="beast-modal-body">
        This is the only time the password will be shown. Copy it now.
      </p>
      <div className="beast-card beast-flex beast-flex-gap-sm beast-mb-md">
        <code className="beast-flex-1 beast-td-code">{password}</code>
        <button
          onClick={handleCopy}
          className="beast-btn beast-btn-primary beast-btn-sm"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="beast-modal-actions">
        <button
          onClick={onClose}
          className="beast-btn beast-btn-outline"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}

// ── Add User modal ────────────────────────────────────────────────

function AddUserModal({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  const createUser = useCreateUser();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || createUser.isPending) return;
    setError('');

    createUser.mutate(
      { username: username.trim(), displayName: displayName.trim() || undefined },
      {
        onSuccess: (data) => {
          setCreatedPassword(data.generatedPassword);
        },
        onError: (err: any) => {
          setError(err.message || 'Failed to create user');
        },
      },
    );
  }

  if (createdPassword !== null) {
    return (
      <PasswordDialog
        title="User created"
        password={createdPassword}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal title="Add User" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="beast-error">
            {error}
          </div>
        )}
        <div>
          <label htmlFor="new-username" className="beast-label">
            Username
          </label>
          <input
            id="new-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            className="beast-input"
          />
        </div>
        <div>
          <label htmlFor="new-displayname" className="beast-label">
            Display Name <span className="beast-toggle-text">(optional)</span>
          </label>
          <input
            id="new-displayname"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="beast-input"
          />
        </div>
        <div className="beast-modal-actions">
          <button
            type="button"
            onClick={onClose}
            className="beast-btn beast-btn-outline"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!username.trim() || createUser.isPending}
            className="beast-btn beast-btn-primary"
          >
            {createUser.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Edit User modal ───────────────────────────────────────────────

function EditUserModal({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [error, setError] = useState('');

  const updateUser = useUpdateUser();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (updateUser.isPending) return;
    setError('');

    updateUser.mutate(
      { id: user.id, displayName: displayName.trim() || undefined },
      {
        onSuccess: () => onClose(),
        onError: (err: any) => setError(err.message || 'Failed to update user'),
      },
    );
  }

  return (
    <Modal title={`Edit ${user.username}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="beast-error">
            {error}
          </div>
        )}
        <div>
          <label htmlFor="edit-displayname" className="beast-label">
            Display Name
          </label>
          <input
            id="edit-displayname"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
            className="beast-input"
          />
        </div>
        <div className="beast-modal-actions">
          <button
            type="button"
            onClick={onClose}
            className="beast-btn beast-btn-outline"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={updateUser.isPending}
            className="beast-btn beast-btn-primary"
          >
            {updateUser.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Reset Password modal ──────────────────────────────────────────

function ResetPasswordModal({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [newPassword, setNewPassword] = useState<string | null>(null);

  const updateUser = useUpdateUser();

  function handleReset() {
    if (updateUser.isPending) return;
    setError('');

    updateUser.mutate(
      { id: user.id, resetPassword: true },
      {
        onSuccess: (data) => {
          if (data.generatedPassword) {
            setNewPassword(data.generatedPassword);
          }
        },
        onError: (err: any) => setError(err.message || 'Failed to reset password'),
      },
    );
  }

  if (newPassword !== null) {
    return (
      <PasswordDialog
        title="Password reset"
        password={newPassword}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal title={`Reset password for ${user.username}`} onClose={onClose}>
      {error && (
        <div className="beast-error beast-mb-md">
          {error}
        </div>
      )}
      <p className="beast-modal-body">
        A new password will be generated for <strong>{user.username}</strong>. Their current password will be invalidated.
      </p>
      <div className="beast-modal-actions">
        <button
          type="button"
          onClick={onClose}
          className="beast-btn beast-btn-outline"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={updateUser.isPending}
          className="beast-btn beast-btn-primary"
        >
          {updateUser.isPending ? 'Resetting…' : 'Reset Password'}
        </button>
      </div>
    </Modal>
  );
}

// ── Delete User modal ─────────────────────────────────────────────

function DeleteUserModal({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const deleteUser = useDeleteUser();

  function handleDelete() {
    if (deleteUser.isPending) return;
    setError('');

    deleteUser.mutate(user.id, {
      onSuccess: () => onClose(),
      onError: (err: any) => setError(err.message || 'Failed to delete user'),
    });
  }

  return (
    <Modal title={`Delete ${user.username}`} onClose={onClose}>
      {error && (
        <div className="beast-error beast-mb-md">
          {error}
        </div>
      )}
      <p className="beast-modal-body">
        Are you sure you want to delete <strong>{user.username}</strong>? This action cannot be undone.
      </p>
      <div className="beast-modal-actions">
        <button
          type="button"
          onClick={onClose}
          className="beast-btn beast-btn-outline"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleteUser.isPending}
          className="beast-btn beast-btn-danger"
        >
          {deleteUser.isPending ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Modal>
  );
}

// ── Role badge ────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const isSuperAdmin = role === 'super_admin';
  return (
    <span
      className={`beast-badge ${
        isSuperAdmin
          ? 'beast-badge-red'
          : 'beast-badge-gray'
      }`}
    >
      {isSuperAdmin ? 'super_admin' : role}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────

type ModalState =
  | { type: 'none' }
  | { type: 'add' }
  | { type: 'edit'; user: AdminUser }
  | { type: 'resetPassword'; user: AdminUser }
  | { type: 'delete'; user: AdminUser };

export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const { data: users, isLoading } = useAdminUsers();
  const [modal, setModal] = useState<ModalState>({ type: 'none' });

  function closeModal() {
    setModal({ type: 'none' });
  }

  const superAdminCount = users?.filter((u) => u.role === 'super_admin').length ?? 0;

  function canDelete(u: AdminUser): boolean {
    if (currentUser && u.id === currentUser.id) return false;
    if (u.role === 'super_admin' && superAdminCount <= 1) return false;
    return true;
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="beast-page-title">Users</h1>
            <p className="beast-page-subtitle">Manage system users and their access.</p>
          </div>
          <button
            onClick={() => setModal({ type: 'add' })}
            className="beast-btn beast-btn-primary"
          >
            Add User
          </button>
        </div>

        <div className="beast-table-wrap">
          {isLoading ? (
            <div className="beast-empty">Loading…</div>
          ) : !users || users.length === 0 ? (
            <div className="beast-empty">No users found.</div>
          ) : (
            <table className="beast-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Display Name</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th>Workspaces</th>
                  <th className="beast-th-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="beast-td-primary">
                      {u.username}
                      {currentUser && u.id === currentUser.id && (
                        <span className="beast-badge beast-badge-gray">(you)</span>
                      )}
                    </td>
                    <td>{u.displayName ?? '—'}</td>
                    <td>
                      <RoleBadge role={u.role} />
                    </td>
                    <td>
                      {formatDate(u.createdAt)}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {u.workspaces.length === 0 ? (
                          <span className="beast-badge beast-badge-gray">None</span>
                        ) : (
                          u.workspaces.map((ws) => (
                            <span
                              key={ws.workspaceId}
                              className="beast-badge beast-badge-blue"
                            >
                              {ws.name}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="beast-td-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setModal({ type: 'edit', user: u })}
                          className="beast-btn beast-btn-outline beast-btn-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setModal({ type: 'resetPassword', user: u })}
                          className="beast-btn beast-btn-outline beast-btn-sm"
                        >
                          Reset Password
                        </button>
                        <button
                          onClick={() => setModal({ type: 'delete', user: u })}
                          disabled={!canDelete(u)}
                          title={
                            currentUser && u.id === currentUser.id
                              ? 'Cannot delete yourself'
                              : u.role === 'super_admin' && superAdminCount <= 1
                                ? 'Cannot delete the last super_admin'
                                : 'Delete user'
                          }
                          className="beast-btn beast-btn-danger beast-btn-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal.type === 'add' && <AddUserModal onClose={closeModal} />}
      {modal.type === 'edit' && <EditUserModal user={modal.user} onClose={closeModal} />}
      {modal.type === 'resetPassword' && <ResetPasswordModal user={modal.user} onClose={closeModal} />}
      {modal.type === 'delete' && <DeleteUserModal user={modal.user} onClose={closeModal} />}
    </>
  );
}
