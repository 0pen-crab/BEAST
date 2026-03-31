import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { ProtectedRoute } from './protected-route';

// Mock useAuth, useWorkspace, and permissions
vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/workspace', () => ({
  useWorkspace: vi.fn(),
}));

vi.mock('@/lib/permissions', () => ({
  isSuperAdmin: vi.fn((role: string) => role === 'super_admin'),
}));

import { useAuth } from '@/lib/auth';
import { useWorkspace } from '@/lib/workspace';

const mockUseAuth = vi.mocked(useAuth);
const mockUseWorkspace = vi.mocked(useWorkspace);

beforeEach(() => {
  vi.clearAllMocks();
});

function renderWithRouter(initialEntries: string[] = ['/protected']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/protected" element={<div>Protected Content</div>} />
          <Route path="/admin/workspaces" element={<div>Admin Workspaces Page</div>} />
          <Route path="/admin/users" element={<div>Admin Users Page</div>} />
          <Route path="/onboarding" element={<div>Onboarding Page</div>} />
        </Route>
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('redirects to /login when not authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      token: null,
      user: null,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockUseWorkspace.mockReturnValue({
      workspaces: [],
      currentWorkspace: null,
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    });

    renderWithRouter();
    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('shows loading state when workspace is loading', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      token: 'tok',
      user: { id: 1, username: 'admin', displayName: null, role: 'admin' },
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockUseWorkspace.mockReturnValue({
      workspaces: [],
      currentWorkspace: null,
      switchWorkspace: vi.fn(),
      isLoading: true,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    });

    renderWithRouter();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('shows no workspace assigned message for regular user who needs onboarding', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      token: 'tok',
      user: { id: 1, username: 'alice', displayName: null, role: 'member' },
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockUseWorkspace.mockReturnValue({
      workspaces: [],
      currentWorkspace: null,
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: true,
      refetchWorkspaces: vi.fn(),
    });

    renderWithRouter();
    expect(screen.getByText('No workspace assigned')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('redirects super_admin to /onboarding when needs onboarding', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      token: 'tok',
      user: { id: 1, username: 'admin', displayName: null, role: 'super_admin' },
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockUseWorkspace.mockReturnValue({
      workspaces: [],
      currentWorkspace: null,
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: true,
      refetchWorkspaces: vi.fn(),
    });

    renderWithRouter();
    expect(screen.getByText('Onboarding Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('renders admin page for super_admin already on /admin route when needs onboarding', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      token: 'tok',
      user: { id: 1, username: 'admin', displayName: null, role: 'super_admin' },
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockUseWorkspace.mockReturnValue({
      workspaces: [],
      currentWorkspace: null,
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: true,
      refetchWorkspaces: vi.fn(),
    });

    renderWithRouter(['/admin/workspaces']);
    expect(screen.getByText('Admin Workspaces Page')).toBeInTheDocument();
  });

  it('renders outlet content when authenticated and loaded', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      token: 'tok',
      user: { id: 1, username: 'admin', displayName: null, role: 'admin' },
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockUseWorkspace.mockReturnValue({
      workspaces: [{ id: 1, name: 'ws', description: null, defaultLanguage: 'en', createdAt: '' }],
      currentWorkspace: { id: 1, name: 'ws', description: null, defaultLanguage: 'en', createdAt: '' },
      switchWorkspace: vi.fn(),
      isLoading: false,
      needsOnboarding: false,
      refetchWorkspaces: vi.fn(),
    });

    renderWithRouter();
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });
});
