import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { NotFoundPage } from './not-found';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

describe('NotFoundPage', () => {
  it('renders the 404 text', () => {
    renderWithProviders(<NotFoundPage />);

    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('renders the page not found message', () => {
    renderWithProviders(<NotFoundPage />);

    expect(screen.getByText('common.pageNotFound')).toBeInTheDocument();
  });

  it('renders a link back to dashboard', () => {
    renderWithProviders(<NotFoundPage />);

    const link = screen.getByRole('link', { name: 'common.backToDashboard' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/');
  });
});
