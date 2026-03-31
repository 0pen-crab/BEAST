import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test-utils';
import { IntegrationPanel } from './integration-panel';
import type { CredentialField } from '@/api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'tools.howToGet': 'How to get your token',
        'onboarding.connected': 'Connected',
        'onboarding.validating': 'Validating...',
        'onboarding.usedBy': 'Used by',
      };
      return map[key] ?? key;
    },
  }),
}));

const apiKeyField: CredentialField = {
  envVar: 'SNYK_TOKEN',
  label: 'API Token',
  placeholder: 'Enter your Snyk token',
  helpUrl: 'https://docs.snyk.io/api/token',
  required: true,
  vaultLabel: 'snyk_token',
};

const defaultProps = {
  name: 'Snyk',
  iconLetter: 'S',
  iconColor: 'bg-purple-600',
  credentials: [apiKeyField],
  onValidate: vi.fn(),
  status: 'pending' as const,
};

describe('IntegrationPanel', () => {
  it('renders tool name and credential input in pending state', () => {
    renderWithProviders(<IntegrationPanel {...defaultProps} />);

    expect(screen.getByText('Snyk')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your Snyk token')).toBeInTheDocument();
    expect(screen.getByText('API Token')).toBeInTheDocument();
  });

  it('renders connected state with checkmark and no input visible', () => {
    renderWithProviders(
      <IntegrationPanel {...defaultProps} status="connected" />,
    );

    expect(screen.getByText('Snyk')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByLabelText('connected')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter your Snyk token')).not.toBeInTheDocument();
  });

  it('calls onValidate with credential values when Add clicked', async () => {
    const onValidate = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <IntegrationPanel {...defaultProps} onValidate={onValidate} />,
    );

    const input = screen.getByPlaceholderText('Enter your Snyk token');
    await user.type(input, 'my-secret-token');

    const addButton = screen.getByRole('button', { name: 'Add' });
    await user.click(addButton);

    expect(onValidate).toHaveBeenCalledWith({ SNYK_TOKEN: 'my-secret-token' });
  });

  it('disables input during validating state', () => {
    renderWithProviders(
      <IntegrationPanel {...defaultProps} status="validating" />,
    );

    const input = screen.getByPlaceholderText('Enter your Snyk token');
    expect(input).toBeDisabled();

    const button = screen.getByRole('button', { name: 'Validating...' });
    expect(button).toBeDisabled();
  });

  it('shows error message in error state', () => {
    renderWithProviders(
      <IntegrationPanel
        {...defaultProps}
        status="error"
        error="Invalid token. Please check and try again."
      />,
    );

    expect(screen.getByText('Invalid token. Please check and try again.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your Snyk token')).toBeInTheDocument();
  });

  it('shows usedBy tools when provided with more than one item', () => {
    renderWithProviders(
      <IntegrationPanel {...defaultProps} usedBy={['Code', 'SCA']} />,
    );

    expect(screen.getByText('Code', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/SCA/, { exact: false })).toBeInTheDocument();
  });
});
