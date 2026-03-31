import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination } from './pagination';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common.first': 'First',
        'common.last': 'Last',
        'common.page': 'Page',
        'common.of': 'of',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('Pagination', () => {
  it('renders nothing when totalPages <= 1', () => {
    const { container } = render(<Pagination page={0} totalPages={1} onPageChange={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders all page numbers when totalPages <= 5', () => {
    render(<Pagination page={0} totalPages={4} onPageChange={() => {}} />);
    for (let i = 1; i <= 4; i++) {
      expect(screen.getByText(String(i))).toBeInTheDocument();
    }
  });

  it('renders First and Last buttons', () => {
    render(<Pagination page={2} totalPages={10} onPageChange={() => {}} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Last')).toBeInTheDocument();
  });

  it('disables First button on first page', () => {
    render(<Pagination page={0} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByText('First')).toBeDisabled();
  });

  it('disables Last button on last page', () => {
    render(<Pagination page={4} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByText('Last')).toBeDisabled();
  });

  it('marks current page as active', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={() => {}} />);
    // page=2 is 0-indexed, displayed as "3"
    const btn = screen.getByText('3');
    expect(btn.className).toContain('beast-pagination-active');
  });

  it('calls onPageChange with 0-indexed page when clicking a page number', async () => {
    const onChange = vi.fn();
    render(<Pagination page={0} totalPages={5} onPageChange={onChange} />);
    // Click on displayed "3" which is 0-indexed page 2
    await userEvent.click(screen.getByText('3'));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange with 0 when clicking First', async () => {
    const onChange = vi.fn();
    render(<Pagination page={3} totalPages={5} onPageChange={onChange} />);
    await userEvent.click(screen.getByText('First'));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('calls onPageChange with totalPages-1 when clicking Last', async () => {
    const onChange = vi.fn();
    render(<Pagination page={2} totalPages={10} onPageChange={onChange} />);
    await userEvent.click(screen.getByText('Last'));
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it('shows ellipsis for large page counts', () => {
    render(<Pagination page={5} totalPages={20} onPageChange={() => {}} />);
    const ellipses = screen.getAllByText('…');
    expect(ellipses.length).toBe(2);
  });

  it('displays 1-indexed page info text', () => {
    render(<Pagination page={2} totalPages={10} onPageChange={() => {}} />);
    expect(screen.getByText('Page 3 of 10')).toBeInTheDocument();
  });

  it('shows sliding window of 5 pages in the middle', () => {
    render(<Pagination page={5} totalPages={20} onPageChange={() => {}} />);
    // Should show pages 4,5,6,7,8 (displayed as 4,5,6,7,8 but 0-indexed 3,4,5,6,7)
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });
});
