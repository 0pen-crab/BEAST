interface StatusChangeDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function StatusChangeDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: StatusChangeDialogProps) {
  if (!open) return null;

  return (
    <div className="beast-overlay">
      <div className="beast-backdrop" onClick={onCancel} />
      <div className="beast-modal">
        <h3 className="beast-modal-title">{title}</h3>
        <p className="beast-modal-body">{description}</p>
        <div className="beast-modal-actions">
          <button
            onClick={onCancel}
            className="beast-btn beast-btn-outline beast-btn-sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="beast-btn beast-btn-primary beast-btn-sm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
