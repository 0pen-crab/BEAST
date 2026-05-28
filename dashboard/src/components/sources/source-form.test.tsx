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

const connectMutateAsync = vi.fn().mockResolvedValue({ source: { id: 1 }, discovered_repos: [] });

vi.mock('@/api/hooks', () => ({
  useConnectSource: vi.fn(() => ({ mutateAsync: connectMutateAsync, isPending: false })),
  useImportFromSource: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ imported: 1 }), isPending: false })),
  useUploadRepoZip: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false })),
}));

function openGitServer() {
  fireEvent.click(screen.getByText('sources.gitServer'));
}

describe('SourceForm', () => {
  it('shows single-repo URL input as default tab', () => {
    renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
    expect(screen.getByPlaceholderText('github.com/org/repo')).toBeInTheDocument();
  });

  it('renders three tabs (single repo, git server, local upload)', () => {
    renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
    expect(screen.getByText('sources.singleRepo')).toBeInTheDocument();
    expect(screen.getByText('sources.gitServer')).toBeInTheDocument();
    expect(screen.getByText('repos.addRepoUpload')).toBeInTheDocument();
    // Legacy split tabs are gone
    expect(screen.queryByText('sources.publicSource')).not.toBeInTheDocument();
    expect(screen.queryByText('sources.privateSource')).not.toBeInTheDocument();
  });

  it('switches to local tab and shows upload area', () => {
    renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
    fireEvent.click(screen.getByText('repos.addRepoUpload'));
    expect(screen.getByText('repos.dropZipHere')).toBeInTheDocument();
  });

  it('renders cancel button when onCancel is provided', () => {
    renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('common.cancel')).toBeInTheDocument();
  });

  describe('Git Server tab', () => {
    it('renders Provider, Deployment, Git Server URL, and token section', () => {
      renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
      openGitServer();
      expect(screen.getByLabelText('settings.provider')).toBeInTheDocument();
      expect(screen.getByLabelText('settings.deployment')).toBeInTheDocument();
      expect(screen.getByLabelText('settings.gitServerUrl')).toBeInTheDocument();
      expect(screen.getByLabelText('settings.accessToken')).toBeInTheDocument();
      expect(screen.getByText('sources.tokenSectionTitle')).toBeInTheDocument();
      expect(screen.getByText('sources.tokenSectionDesc')).toBeInTheDocument();
    });

    it('defaults the provider to GitHub', () => {
      renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
      openGitServer();
      expect((screen.getByLabelText('settings.provider') as HTMLSelectElement).value).toBe('github');
    });

    it('placeholder for URL changes by provider × deployment', () => {
      renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
      openGitServer();

      // Default: gitlab + cloud
      fireEvent.change(screen.getByLabelText('settings.provider'), { target: { value: 'gitlab' } });
      fireEvent.change(screen.getByLabelText('settings.deployment'), { target: { value: 'cloud' } });
      expect((screen.getByLabelText('settings.gitServerUrl') as HTMLInputElement).placeholder).toBe('https://gitlab.com/my-group');

      // gitlab self-hosted
      fireEvent.change(screen.getByLabelText('settings.deployment'), { target: { value: 'self-hosted' } });
      expect((screen.getByLabelText('settings.gitServerUrl') as HTMLInputElement).placeholder).toBe('https://gitlab.example.com/my-group');

      // github cloud
      fireEvent.change(screen.getByLabelText('settings.provider'), { target: { value: 'github' } });
      fireEvent.change(screen.getByLabelText('settings.deployment'), { target: { value: 'cloud' } });
      expect((screen.getByLabelText('settings.gitServerUrl') as HTMLInputElement).placeholder).toBe('https://github.com/my-org');

      // bitbucket cloud
      fireEvent.change(screen.getByLabelText('settings.provider'), { target: { value: 'bitbucket' } });
      fireEvent.change(screen.getByLabelText('settings.deployment'), { target: { value: 'cloud' } });
      expect((screen.getByLabelText('settings.gitServerUrl') as HTMLInputElement).placeholder).toBe('https://bitbucket.org/my-workspace');
    });

    // ── Cloud: base_url is the provider's known API host, input gives only the org ──

    it('github cloud: base_url=api.github.com, org extracted from full URL', async () => {
      connectMutateAsync.mockClear();
      renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
      openGitServer();

      fireEvent.change(screen.getByLabelText('settings.provider'), { target: { value: 'github' } });
      fireEvent.change(screen.getByLabelText('settings.deployment'), { target: { value: 'cloud' } });
      fireEvent.change(screen.getByLabelText('settings.gitServerUrl'), {
        target: { value: 'https://github.com/acme-org' },
      });
      fireEvent.click(screen.getByText('sources.addSource'));

      await vi.waitFor(() => expect(connectMutateAsync).toHaveBeenCalled());
      const payload = connectMutateAsync.mock.calls[0][0];
      expect(payload).toMatchObject({
        provider: 'github',
        base_url: 'https://api.github.com',
        org_name: 'acme-org',
      });
      expect(payload.access_token).toBeUndefined();
    });

    it('github cloud: accepts a bare org name (no URL)', async () => {
      connectMutateAsync.mockClear();
      renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
      openGitServer();

      fireEvent.change(screen.getByLabelText('settings.provider'), { target: { value: 'github' } });
      fireEvent.change(screen.getByLabelText('settings.deployment'), { target: { value: 'cloud' } });
      fireEvent.change(screen.getByLabelText('settings.gitServerUrl'), { target: { value: 'acme-org' } });
      fireEvent.click(screen.getByText('sources.addSource'));

      await vi.waitFor(() => expect(connectMutateAsync).toHaveBeenCalled());
      expect(connectMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        base_url: 'https://api.github.com',
        org_name: 'acme-org',
      }));
    });

    it('bitbucket cloud: base_url=api.bitbucket.org/2.0', async () => {
      connectMutateAsync.mockClear();
      renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
      openGitServer();

      fireEvent.change(screen.getByLabelText('settings.provider'), { target: { value: 'bitbucket' } });
      fireEvent.change(screen.getByLabelText('settings.deployment'), { target: { value: 'cloud' } });
      fireEvent.change(screen.getByLabelText('settings.gitServerUrl'), {
        target: { value: 'https://bitbucket.org/my-workspace' },
      });
      fireEvent.click(screen.getByText('sources.addSource'));

      await vi.waitFor(() => expect(connectMutateAsync).toHaveBeenCalled());
      expect(connectMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        base_url: 'https://api.bitbucket.org/2.0',
        org_name: 'my-workspace',
      }));
    });

    it('gitlab cloud: base_url=gitlab.com regardless of input host', async () => {
      connectMutateAsync.mockClear();
      renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
      openGitServer();

      fireEvent.change(screen.getByLabelText('settings.provider'), { target: { value: 'gitlab' } });
      fireEvent.change(screen.getByLabelText('settings.deployment'), { target: { value: 'cloud' } });
      fireEvent.change(screen.getByLabelText('settings.gitServerUrl'), { target: { value: 'gnome' } });
      fireEvent.click(screen.getByText('sources.addSource'));

      await vi.waitFor(() => expect(connectMutateAsync).toHaveBeenCalled());
      expect(connectMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        base_url: 'https://gitlab.com',
        org_name: 'gnome',
      }));
    });

    // ── Self-hosted: base_url derived from the entered host ──

    it('gitlab self-hosted: derives base_url from host, org from path', async () => {
      connectMutateAsync.mockClear();
      renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
      openGitServer();

      fireEvent.change(screen.getByLabelText('settings.provider'), { target: { value: 'gitlab' } });
      fireEvent.change(screen.getByLabelText('settings.deployment'), { target: { value: 'self-hosted' } });
      fireEvent.change(screen.getByLabelText('settings.gitServerUrl'), {
        target: { value: 'https://gitlab.example.com/some-group' },
      });
      fireEvent.change(screen.getByLabelText('settings.accessToken'), { target: { value: 'glpat-xxx' } });
      fireEvent.click(screen.getByText('sources.addSource'));

      await vi.waitFor(() => expect(connectMutateAsync).toHaveBeenCalled());
      expect(connectMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'gitlab',
        base_url: 'https://gitlab.example.com',
        org_name: 'some-group',
        access_token: 'glpat-xxx',
      }));
    });

    it('gitlab self-hosted: bare server URL (no group) for server-wide listing', async () => {
      connectMutateAsync.mockClear();
      renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
      openGitServer();

      fireEvent.change(screen.getByLabelText('settings.provider'), { target: { value: 'gitlab' } });
      fireEvent.change(screen.getByLabelText('settings.deployment'), { target: { value: 'self-hosted' } });
      fireEvent.change(screen.getByLabelText('settings.gitServerUrl'), {
        target: { value: 'https://gitlab.example.com' },
      });
      fireEvent.click(screen.getByText('sources.addSource'));

      await vi.waitFor(() => expect(connectMutateAsync).toHaveBeenCalled());
      const payload = connectMutateAsync.mock.calls[0][0];
      expect(payload.base_url).toBe('https://gitlab.example.com');
      expect(payload.org_name).toBeUndefined();
    });

    it('gitlab self-hosted: normalizes host without scheme and takes first path segment', async () => {
      connectMutateAsync.mockClear();
      renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
      openGitServer();

      fireEvent.change(screen.getByLabelText('settings.provider'), { target: { value: 'gitlab' } });
      fireEvent.change(screen.getByLabelText('settings.deployment'), { target: { value: 'self-hosted' } });
      fireEvent.change(screen.getByLabelText('settings.gitServerUrl'), {
        target: { value: 'git.example.com/some-group/sub/extra/' },
      });
      fireEvent.click(screen.getByText('sources.addSource'));

      await vi.waitFor(() => expect(connectMutateAsync).toHaveBeenCalled());
      expect(connectMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        base_url: 'https://git.example.com',
        org_name: 'some-group',
      }));
    });

    it('github self-hosted (GHE): base_url is host + /api/v3', async () => {
      connectMutateAsync.mockClear();
      renderWithProviders(<SourceForm workspaceId={1} onConnected={vi.fn()} />);
      openGitServer();

      fireEvent.change(screen.getByLabelText('settings.provider'), { target: { value: 'github' } });
      fireEvent.change(screen.getByLabelText('settings.deployment'), { target: { value: 'self-hosted' } });
      fireEvent.change(screen.getByLabelText('settings.gitServerUrl'), {
        target: { value: 'https://ghe.example.com/my-org' },
      });
      fireEvent.click(screen.getByText('sources.addSource'));

      await vi.waitFor(() => expect(connectMutateAsync).toHaveBeenCalled());
      expect(connectMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        base_url: 'https://ghe.example.com/api/v3',
        org_name: 'my-org',
      }));
    });
  });
});
