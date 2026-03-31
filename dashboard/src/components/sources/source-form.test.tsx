import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { SourceForm } from './source-form';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/api/hooks', () => ({
  useConnectSource: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useImportFromSource: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ imported: 1 }), isPending: false })),
  useUploadRepoZip: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

describe('SourceForm', () => {
  it('shows single-repo URL input as default tab', () => {
    renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
    expect(screen.getByPlaceholderText('github.com/org/repo')).toBeInTheDocument();
  });

  it('renders all four tabs', () => {
    renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
    expect(screen.getByText('sources.singleRepo')).toBeInTheDocument();
    expect(screen.getByText('sources.publicSource')).toBeInTheDocument();
    expect(screen.getByText('sources.privateSource')).toBeInTheDocument();
    expect(screen.getByText('repos.addRepoUpload')).toBeInTheDocument();
  });

  it('shows public URL input on public tab', () => {
    renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
    fireEvent.click(screen.getByText('sources.publicSource'));
    expect(screen.getByPlaceholderText('github.com/org-or-username')).toBeInTheDocument();
  });

  it('switches to private tab and shows provider/token fields', () => {
    renderWithProviders(
      <SourceForm workspaceId={1} onConnected={vi.fn()} />
    );
    fireEvent.click(screen.getByText('sources.privateSource'));
    expect(screen.getByLabelText('settings.provider')).toBeInTheDocument();
    expect(screen.getByLabelText('settings.accessToken')).toBeInTheDocument();
  });

  it('switches to local tab and shows upload area', () => {
    renderWithProviders(
      <SourceForm workspaceId={1} onConnected={vi.fn()} />
    );
    fireEvent.click(screen.getByText('repos.addRepoUpload'));
    expect(screen.getByText('repos.dropZipHere')).toBeInTheDocument();
  });

  it('renders cancel button when onCancel is provided', () => {
    renderWithProviders(
      <SourceForm workspaceId={1} onConnected={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByText('common.cancel')).toBeInTheDocument();
  });
});
