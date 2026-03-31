import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { CredentialField } from '@/api/types';

export type IntegrationStatus = 'pending' | 'validating' | 'connected' | 'error';

interface IntegrationPanelProps {
  name: string;
  iconLetter: string;
  iconColor: string;
  iconUrl?: string;
  credentials: CredentialField[];
  onValidate: (values: Record<string, string>) => void;
  onDisconnect?: () => void;
  status: IntegrationStatus;
  error?: string;
  usedBy?: string[];
}

export function IntegrationPanel({
  name,
  iconLetter,
  iconColor,
  iconUrl,
  credentials,
  onValidate,
  onDisconnect,
  status,
  error,
  usedBy,
}: IntegrationPanelProps) {
  const { t } = useTranslation();

  const initialValues: Record<string, string> = {};
  for (const cred of credentials) {
    initialValues[cred.envVar] = '';
  }
  const [values, setValues] = useState<Record<string, string>>(initialValues);

  const isDisabled = status === 'validating';
  const isConnected = status === 'connected';

  function handleChange(envVar: string, value: string) {
    setValues((prev) => ({ ...prev, [envVar]: value }));
  }

  function handleAdd() {
    onValidate(values);
  }

  const iconEl = iconUrl ? (
    <img src={iconUrl} alt={name} className="h-8 w-8 shrink-0 rounded-sm object-cover" />
  ) : (
    <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center text-sm font-bold text-white rounded-sm', iconColor)}>
      {iconLetter}
    </div>
  );

  if (isConnected) {
    return (
      <div className="beast-integration-card">
        <div className="beast-flex beast-flex-gap-sm">
          {iconEl}
          <span className="beast-integration-name">{name}</span>
        </div>
        <div className="beast-integration-footer">
          <div className="beast-integration-status">
            <svg
              aria-label="connected"
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            <span>{t('onboarding.connected')}</span>
          </div>
          {onDisconnect && (
            <button
              type="button"
              onClick={onDisconnect}
              className="beast-btn beast-btn-primary beast-btn-sm"
            >
              {t('common.disconnect')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-th-bg border border-th-border p-3.5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        {iconEl}
        <span className="text-sm font-semibold text-th-text">{name}</span>
        {usedBy && usedBy.length > 1 && (
          <span className="ml-auto text-xs text-th-text-muted">
            {t('onboarding.usedBy')}: {usedBy.join(', ')}
          </span>
        )}
      </div>

      {/* Credential inputs */}
      <div className="space-y-3">
        {credentials.map((cred) => (
          <div key={cred.envVar}>
            <label className="beast-label">{cred.label}</label>
            <input
              type="text"
              name={`cred-${cred.envVar}`}
              autoComplete="off"
              style={/url/i.test(cred.envVar) || /url/i.test(cred.label) ? undefined : { WebkitTextSecurity: 'disc' } as any}
              placeholder={cred.placeholder}
              value={values[cred.envVar] ?? ''}
              disabled={isDisabled}
              onChange={(e) => handleChange(cred.envVar, e.target.value)}
              className="beast-input beast-input-sm"
            />
            <a
              href={cred.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-[11px] text-th-text-muted hover:text-beast-red"
            >
              {/url/i.test(cred.envVar) || /url/i.test(cred.label) ? t('tools.whatIsUrl') : t('tools.whereGetToken')}
            </a>
          </div>
        ))}
      </div>

      {/* Error message */}
      {status === 'error' && error && (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      )}

      {/* Add button */}
      <button
        type="button"
        disabled={isDisabled}
        onClick={handleAdd}
        className="mt-3 beast-btn beast-btn-primary beast-btn-sm"
      >
        {isDisabled ? t('onboarding.validating') : 'Add'}
      </button>
    </div>
  );
}
