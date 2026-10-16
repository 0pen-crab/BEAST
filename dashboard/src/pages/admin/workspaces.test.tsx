import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test-utils';
import { AdminWorkspacesPage } from './workspaces';

const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: vi.fn(() => mockNavigate),
  };
});

vi.mock('@/lib/workspace', () => ({
  useWorkspace: vi.fn(() => ({
    workspaces: [{ id: 1, name: 'Test WS', description: null, defaultLanguage: 'en', createdAt: '2026-01-01' }],
    currentWorkspace: { id: 1, name: 'Test WS', description: null, defaultLanguage: 'en', createdAt: '2026-01-01' },
    switchWorkspace: vi.fn(),
    isLoading: false,
    needsOnboarding: false,
    refetchWorkspaces: vi.fn(),
  })),
}));

vi.mock('@/api/hooks', () => ({
  useAdminWorkspaces: vi.fn(() => ({
    data: [
      {
        id: 1,
        name: 'Alpha',
        description: 'Alpha workspace',
        defaultLanguage: 'en',
        createdAt: '2026-01-01T00:00:00Z',
        memberCount: 3,
        scanCount: 12,
      },
      {
        id: 2,
        name: 'Beta',
        description: null,
        defaultLanguage: 'uk',
        createdAt: '2026-02-01T00:00:00Z',
        memberCount: 1,
        scanCount: 0,
      },
    ],
    isLoading: false,
    refetch: vi.fn(),
  })),
}));

describe('AdminWorkspacesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders page heading', () => {
    renderWithProviders(<AdminWorkspacesPage />);
    expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeInTheDocument();
  });

  it('renders Create Workspace button', () => {
    renderWithProviders(<AdminWorkspacesPage />);
    expect(screen.getByRole('button', { name: /Create Workspace/i })).toBeInTheDocument();
  });

  it('renders table column headers', () => {
    renderWithProviders(<AdminWorkspacesPage />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.getByText('Scans')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('renders workspace rows', () => {
    renderWithProviders(<AdminWorkspacesPage />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('renders member counts', () => {
    renderWithProviders(<AdminWorkspacesPage />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders scan counts', () => {
    renderWithProviders(<AdminWorkspacesPage />);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('navigates to onboarding wizard when Create Workspace clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminWorkspacesPage />);

    await user.click(screen.getByRole('button', { name: /Create Workspace/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding');
  });

  it('shows loading state', async () => {
    const hooks = await import('@/api/hooks');
    vi.mocked(hooks.useAdminWorkspaces).mockReturnValueOnce({ data: undefined, isLoading: true, refetch: vi.fn() } as any);

    renderWithProviders(<AdminWorkspacesPage />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('shows description when available', () => {
    renderWithProviders(<AdminWorkspacesPage />);
    expect(screen.getByText('Alpha workspace')).toBeInTheDocument();
  });
});
