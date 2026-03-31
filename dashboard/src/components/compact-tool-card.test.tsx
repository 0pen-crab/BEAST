import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { CompactToolCard } from './compact-tool-card';
import type { ToolDefinition } from '@/api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'tools.badges.free': 'Free & Open Source',
        'tools.badges.commercial': 'Commercial',
      };
      return map[key] ?? key;
    },
  }),
}));

const freeTool: ToolDefinition = {
  key: 'gitleaks',
  displayName: 'Gitleaks',
  description: 'Scan git repos for secrets and keys',
  category: 'secrets',
  website: 'https://gitleaks.io',
  credentials: [],
  recommended: true,
  pricing: 'free',
  runnerKey: 'gitleaks',
};

const paidTool: ToolDefinition = {
  key: 'gitguardian',
  displayName: 'GitGuardian',
  description: 'Enterprise secret detection platform',
  category: 'secrets',
  website: 'https://gitguardian.com',
  credentials: [
    {
      envVar: 'GITGUARDIAN_API_KEY',
      label: 'API Key',
      placeholder: 'Enter API key',
      helpUrl: 'https://docs.gitguardian.com/api/getting-started',
      required: true,
      vaultLabel: 'gitguardian_api_key',
    },
  ],
  recommended: false,
  pricing: 'free_tier',
  runnerKey: 'gitguardian',
};

describe('CompactToolCard', () => {
  it('renders tool name and description', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <CompactToolCard tool={freeTool} enabled={false} onToggle={onToggle} />,
    );

    expect(screen.getByText('Gitleaks')).toBeInTheDocument();
    expect(screen.getByText('Scan git repos for secrets and keys')).toBeInTheDocument();
  });

  it('shows enabled state with checked toggle', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <CompactToolCard tool={freeTool} enabled={true} onToggle={onToggle} />,
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();
  });

  it('shows disabled state with unchecked toggle', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <CompactToolCard tool={freeTool} enabled={false} onToggle={onToggle} />,
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).not.toBeChecked();
  });

  it('calls onToggle(key, !enabled) when toggle clicked', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <CompactToolCard tool={freeTool} enabled={false} onToggle={onToggle} />,
    );

    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledWith('gitleaks', true);
  });

  it('calls onToggle with false when enabled and toggle clicked', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <CompactToolCard tool={freeTool} enabled={true} onToggle={onToggle} />,
    );

    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledWith('gitleaks', false);
  });

  it('shows free badge for free pricing', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <CompactToolCard tool={freeTool} enabled={false} onToggle={onToggle} />,
    );

    expect(screen.getByText('Free & Open Source')).toBeInTheDocument();
  });

  it('shows commercial badge for non-free pricing', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <CompactToolCard tool={paidTool} enabled={false} onToggle={onToggle} />,
    );

    expect(screen.getByText('Commercial')).toBeInTheDocument();
  });

  it('does not render credential inputs (compact mode)', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <CompactToolCard tool={paidTool} enabled={true} onToggle={onToggle} />,
    );

    expect(screen.queryByPlaceholderText('Enter API key')).not.toBeInTheDocument();
    expect(screen.queryByText('API Key')).not.toBeInTheDocument();
  });
});
