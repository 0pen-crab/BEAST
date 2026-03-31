import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getToolIcon, getToolIconColor } from '@/lib/tool-icons';
import type { ToolDefinition } from '@/api/types';

interface CompactToolCardProps {
  tool: ToolDefinition;
  enabled: boolean;
  onToggle: (key: string, enabled: boolean) => void;
}

const categoryColors: Record<string, string> = {
  secrets: 'bg-purple-600',
  sast: 'bg-blue-600',
  sca: 'bg-emerald-600',
  iac: 'bg-amber-600',
};

export function CompactToolCard({ tool, enabled, onToggle }: CompactToolCardProps) {
  const { t } = useTranslation();

  const icon = getToolIcon(tool.key);

  return (
    <div
      className={cn(
        'bg-th-bg border border-th-border p-3.5 transition-colors cursor-pointer',
      )}
      onClick={() => onToggle(tool.key, !enabled)}
    >
      {/* Header: icon, name/description, toggle */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          {/* Tool icon */}
          {icon ? (
            <img
              src={icon}
              alt={tool.displayName}
              className={cn('h-7 w-7 shrink-0 rounded-sm object-cover transition-[filter]', !enabled && 'grayscale opacity-50')}
            />
          ) : (
            <div
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center text-xs font-bold rounded-sm transition-[filter]',
                enabled
                  ? getToolIconColor(tool.key, (categoryColors[tool.category] ?? 'bg-gray-600') + ' text-white')
                  : 'bg-gray-400 text-white opacity-50',
              )}
            >
              {tool.displayName[0]}
            </div>
          )}

          <div className="min-w-0">
            <h3
              className={cn(
                'text-sm font-semibold',
                enabled ? 'text-th-text' : 'text-th-text-muted',
              )}
            >
              {tool.displayName}
            </h3>
            <p className="mt-0.5 text-xs text-th-text-muted line-clamp-2">
              {tool.description}
            </p>
          </div>
        </div>

        {/* Toggle switch */}
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggle(tool.key, !enabled)}
          className="beast-toggle mt-0.5 shrink-0"
        />
      </div>

      {/* Badges row */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {tool.pricing === 'free' ? (
          <span className="beast-badge beast-badge-green">
            {t('tools.badges.free')}
          </span>
        ) : (
          <span className="beast-badge beast-badge-blue">
            {t('tools.badges.commercial')}
          </span>
        )}
      </div>
    </div>
  );
}
