export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="beast-empty">
      <div className="beast-empty-icon">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-th-text-muted">
          <path d="M10 4v6m0 4h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
      <p className="beast-empty-title">{title}</p>
      {description && (
        <p className="beast-empty-desc">{description}</p>
      )}
    </div>
  );
}
