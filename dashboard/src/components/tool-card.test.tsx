import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { ToolCard } from './tool-card';
import type { ToolDefinition } from '@/api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  docsUrl: 'https://docs.gitguardian.com',
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

describe('ToolCard', () => {
  it('renders tool name and description', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={freeTool} enabled={false} onToggle={onToggle} />,
    );

    expect(screen.getByText('Gitleaks')).toBeInTheDocument();
    expect(screen.getByText('Scan git repos for secrets and keys')).toBeInTheDocument();
  });

  it('toggle reflects enabled state and calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={freeTool} enabled={false} onToggle={onToggle} />,
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('gitleaks', true);
  });

  it('toggle shows checked when enabled', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={freeTool} enabled={true} onToggle={onToggle} />,
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();
  });

  it('shows credential panel for non-free tool when enabled', () => {
    const onToggle = vi.fn();
    const onCredentialChange = vi.fn();
    renderWithProviders(
      <ToolCard
        tool={paidTool}
        enabled={true}
        onToggle={onToggle}
        onCredentialChange={onCredentialChange}
        credentialValues={{}}
      />,
    );

    expect(screen.getByText('API Key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter API key')).toBeInTheDocument();
    expect(screen.getByText('tools.howToGet')).toBeInTheDocument();
  });

  it('does not show credential panel for free tool', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={freeTool} enabled={true} onToggle={onToggle} />,
    );

    expect(screen.queryByText('tools.howToGet')).not.toBeInTheDocument();
  });

  it('does not show credential panel when tool is disabled', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={paidTool} enabled={false} onToggle={onToggle} />,
    );

    expect(screen.queryByText('API Key')).not.toBeInTheDocument();
  });

  it('shows "Free & Open Source" badge for free pricing', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={freeTool} enabled={false} onToggle={onToggle} />,
    );

    expect(screen.getByText('tools.badges.free')).toBeInTheDocument();
  });

  it('shows "Free tier available" badge for free_tier pricing', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={paidTool} enabled={false} onToggle={onToggle} />,
    );

    expect(screen.getByText('tools.badges.freeTier')).toBeInTheDocument();
  });

  it('shows "Recommended" badge for recommended tools', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={freeTool} enabled={false} onToggle={onToggle} />,
    );

    expect(screen.getByText('tools.badges.recommended')).toBeInTheDocument();
  });

  it('does not show "Recommended" badge for non-recommended tools', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={paidTool} enabled={false} onToggle={onToggle} />,
    );

    expect(screen.queryByText('tools.badges.recommended')).not.toBeInTheDocument();
  });

  it('shows "Also enabled in" hint when alsoIn prop provided', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard
        tool={freeTool}
        enabled={true}
        onToggle={onToggle}
        alsoIn={['Workspace A', 'Workspace B']}
      />,
    );

    expect(screen.getByText('tools.alsoIn')).toBeInTheDocument();
    expect(screen.getByText('Workspace A, Workspace B')).toBeInTheDocument();
  });

  it('does not show "Also enabled in" when alsoIn is not provided', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={freeTool} enabled={false} onToggle={onToggle} />,
    );

    expect(screen.queryByText('tools.alsoIn')).not.toBeInTheDocument();
  });

  it('toggle is disabled when disabled prop is true', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={freeTool} enabled={true} onToggle={onToggle} disabled={true} />,
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeDisabled();

    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('credential inputs are disabled when disabled prop is true', () => {
    const onToggle = vi.fn();
    const onCredentialChange = vi.fn();
    renderWithProviders(
      <ToolCard
        tool={paidTool}
        enabled={true}
        onToggle={onToggle}
        onCredentialChange={onCredentialChange}
        credentialValues={{}}
        disabled={true}
      />,
    );

    const input = screen.getByPlaceholderText('Enter API key');
    expect(input).toBeDisabled();
  });

  it('calls onCredentialChange when credential input changes', () => {
    const onToggle = vi.fn();
    const onCredentialChange = vi.fn();
    renderWithProviders(
      <ToolCard
        tool={paidTool}
        enabled={true}
        onToggle={onToggle}
        onCredentialChange={onCredentialChange}
        credentialValues={{}}
      />,
    );

    const input = screen.getByPlaceholderText('Enter API key');
    fireEvent.change(input, { target: { value: 'my-secret-key' } });
    expect(onCredentialChange).toHaveBeenCalledWith(
      'gitguardian',
      'GITGUARDIAN_API_KEY',
      'my-secret-key',
    );
  });

  it('shows credential count badge for tools with credentials', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={paidTool} enabled={false} onToggle={onToggle} />,
    );

    expect(screen.getByText(/1 tools.credRequired/)).toBeInTheDocument();
  });

  it('renders website link', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={freeTool} enabled={false} onToggle={onToggle} />,
    );

    const link = screen.getByRole('link', { name: /gitleaks\.io/i });
    expect(link).toHaveAttribute('href', 'https://gitleaks.io');
  });

  it('renders category badge', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ToolCard tool={freeTool} enabled={false} onToggle={onToggle} />,
    );

    expect(screen.getByText('tools.categories.secrets')).toBeInTheDocument();
  });
});
