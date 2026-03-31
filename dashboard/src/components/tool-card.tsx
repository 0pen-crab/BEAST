import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getToolIcon, getToolIconColor } from '@/lib/tool-icons';
import type { ToolDefinition } from '@/api/types';

interface ToolCardProps {
  tool: ToolDefinition;
  enabled: boolean;
  onToggle: (key: string, enabled: boolean) => void;
  onCredentialChange?: (key: string, envVar: string, value: string) => void;
  credentialValues?: Record<string, string>;
  hasCredentials?: boolean;
  alsoIn?: string[];
  disabled?: boolean;
}

const categoryColors: Record<string, string> = {
  secrets: 'bg-purple-600',
  sast: 'bg-blue-600',
  sca: 'bg-emerald-600',
  iac: 'bg-amber-600',
};

export function ToolCard({
  tool,
  enabled,
  onToggle,
  onCredentialChange,
  credentialValues = {},
  alsoIn,
  disabled = false,
}: ToolCardProps) {
  const { t } = useTranslation();

  const showCredentialPanel = enabled && tool.credentials.length > 0;
  const icon = getToolIcon(tool.key);

  return (
    <div
      className={cn(
        'beast-card transition-shadow',
        enabled ? 'border-beast-red/30' : '',
      )}
    >
      {/* Header: logo, name, category, toggle */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {/* Tool icon */}
          {icon ? (
            <img
              src={icon}
              alt={tool.displayName}
              className="h-10 w-10 shrink-0 rounded-sm object-cover"
            />
          ) : (
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center text-sm font-bold rounded-sm',
                getToolIconColor(tool.key, (categoryColors[tool.category] ?? 'bg-gray-600') + ' text-white'),
              )}
            >
              {tool.displayName[0]}
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-th-text">
                {tool.displayName}
              </h3>
              <span className="beast-badge beast-badge-gray">
                {t(`tools.categories.${tool.category}`)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-th-text-muted">
              {tool.description}
            </p>
          </div>
        </div>

        {/* Toggle switch */}
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={disabled}
          onChange={() => { if (!disabled) onToggle(tool.key, !enabled); }}
          className="beast-toggle mt-1"
        />
      </div>

      {/* Credential panel */}
      {showCredentialPanel && (
        <div className="mt-3 space-y-2 border border-th-border-subtle bg-th-bg p-3">
          {tool.credentials.map((cred) => (
            <div key={cred.envVar}>
              <label className="beast-label">
                {cred.label}
              </label>
              <input
                type="password"
                placeholder={cred.placeholder}
                value={credentialValues[cred.envVar] ?? ''}
                disabled={disabled}
                onChange={(e) =>
                  onCredentialChange?.(tool.key, cred.envVar, e.target.value)
                }
                className="beast-input beast-input-sm"
              />
              <a
                href={cred.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-[11px] text-th-text-muted hover:text-beast-red"
              >
                {t('tools.howToGet')}
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Badges row */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {tool.pricing === 'free' && (
          <span className="beast-badge beast-badge-green">
            {t('tools.badges.free')}
          </span>
        )}
        {tool.pricing === 'free_tier' && (
          <span className="beast-badge beast-badge-amber">
            {t('tools.badges.freeTier')}
          </span>
        )}
        {tool.recommended && (
          <span className="beast-badge beast-badge-blue">
            {t('tools.badges.recommended')}
          </span>
        )}
        {tool.credentials.length > 0 && (
          <span className="beast-badge beast-badge-gray">
            {tool.credentials.length} {t('tools.credRequired')}
          </span>
        )}
      </div>

      {/* Also enabled in */}
      {alsoIn && alsoIn.length > 0 && (
        <p className="mt-2 text-[11px] text-th-text-muted">
          <span className="font-medium">{t('tools.alsoIn')}</span>{' '}
          <span>{alsoIn.join(', ')}</span>
        </p>
      )}

      {/* Website link */}
      <div className="mt-2">
        <a
          href={tool.website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-th-text-muted hover:text-beast-red"
        >
          {tool.website.replace(/^https?:\/\//, '')}
        </a>
      </div>
    </div>
  );
}
