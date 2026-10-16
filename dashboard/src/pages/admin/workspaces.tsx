import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAdminWorkspaces } from '@/api/hooks';
import { apiFetch } from '@/api/client';
import { useWorkspace } from '@/lib/workspace';
import { formatDate } from '@/lib/format';
import type { AdminWorkspace } from '@/api/types';

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

// ── Delete Workspace modal ────────────────────────────────────────

function DeleteWorkspaceModal({
  workspace,
  onClose,
  onDeleted,
}: {
  workspace: AdminWorkspace;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function handleDelete() {
    if (confirmText !== workspace.name || deleting) return;
    setDeleting(true);
    setError('');

    try {
      const res = await apiFetch(`/api/workspaces/${workspace.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch((err) => {
          console.error('[admin] Failed to parse error response:', err);
          return {};
        });
        throw new Error(data.message || 'Failed to delete workspace');
      }
      onDeleted();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete workspace');
      setDeleting(false);
    }
  }

  return (
    <Modal title={`Delete ${workspace.name}`} onClose={onClose}>
      {error && (
        <div className="beast-error beast-mb-md">
          {error}
        </div>
      )}
      <p className="beast-modal-body">
        This will permanently delete <strong>{workspace.name}</strong> and all its data. Type the workspace name to confirm.
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        autoFocus
        placeholder={workspace.name}
        className="beast-input beast-mb-md"
      />
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
          disabled={confirmText !== workspace.name || deleting}
          className="beast-btn beast-btn-danger"
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────

type ModalState =
  | { type: 'none' }
  | { type: 'delete'; workspace: AdminWorkspace };

export function AdminWorkspacesPage() {
  const navigate = useNavigate();
  const { data: workspaces, isLoading, refetch } = useAdminWorkspaces();
  const { switchWorkspace, refetchWorkspaces } = useWorkspace();
  const [modal, setModal] = useState<ModalState>({ type: 'none' });

  function closeModal() {
    setModal({ type: 'none' });
  }

  function handleView(ws: AdminWorkspace) {
    switchWorkspace(ws.id);
    navigate('/');
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="beast-page-title">Workspaces</h1>
            <p className="beast-page-subtitle">Overview of all workspaces in the system.</p>
          </div>
          <button
            onClick={() => navigate('/onboarding')}
            className="beast-btn beast-btn-primary"
          >
            Create Workspace
          </button>
        </div>

        <div className="beast-table-wrap">
          {isLoading ? (
            <div className="beast-empty">Loading…</div>
          ) : !workspaces || workspaces.length === 0 ? (
            <div className="beast-empty">No workspaces found.</div>
          ) : (
            <table className="beast-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Members</th>
                  <th>Scans</th>
                  <th>Created</th>
                  <th className="beast-th-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((ws) => (
                  <tr key={ws.id}>
                    <td className="beast-td-primary">{ws.name}</td>
                    <td>
                      {ws.description ?? <span className="beast-badge beast-badge-gray">—</span>}
                    </td>
                    <td>
                      <span className="beast-badge beast-badge-gray">
                        {ws.memberCount}
                      </span>
                    </td>
                    <td>
                      <span className="beast-badge beast-badge-gray">
                        {ws.scanCount}
                      </span>
                    </td>
                    <td>
                      {formatDate(ws.createdAt)}
                    </td>
                    <td className="beast-td-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleView(ws)}
                          className="beast-btn beast-btn-outline beast-btn-sm"
                        >
                          View
                        </button>
                        <button
                          onClick={() => setModal({ type: 'delete', workspace: ws })}
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

      {modal.type === 'delete' && (
        <DeleteWorkspaceModal
          workspace={modal.workspace}
          onClose={closeModal}
          onDeleted={() => { refetch(); refetchWorkspaces(); }}
        />
      )}
    </>
  );
}
