import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { LoginPage } from './login';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(() => ({
    login: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: false,
    token: null,
    user: null,
  })),
}));

describe('LoginPage', () => {
  it('renders the login form with username and password fields', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByLabelText('login.username')).toBeInTheDocument();
    expect(screen.getByLabelText('login.password')).toBeInTheDocument();
  });

  it('renders the sign in button', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole('button', { name: 'login.signIn' })).toBeInTheDocument();
  });

  it('does not render register link', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.queryByText('login.switchToRegister')).not.toBeInTheDocument();
  });

  it('renders the heading with sign in text', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole('heading', { name: 'login.signIn' })).toBeInTheDocument();
  });
});
