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
        'common.previous': 'Previous',
        'common.next': 'Next',
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

  it('renders Prev and Next buttons', () => {
    render(<Pagination page={2} totalPages={10} onPageChange={() => {}} />);
    expect(screen.getByText('Previous')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('Prev goes to the previous page, Next goes to the next page', async () => {
    const onChange = vi.fn();
    render(<Pagination page={3} totalPages={10} onPageChange={onChange} />);
    await userEvent.click(screen.getByText('Previous'));
    expect(onChange).toHaveBeenCalledWith(2);
    await userEvent.click(screen.getByText('Next'));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('disables Prev on first page and Next on last page', () => {
    const { unmount } = render(<Pagination page={0} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByText('Previous')).toBeDisabled();
    expect(screen.getByText('Next')).not.toBeDisabled();
    unmount();
    render(<Pagination page={4} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByText('Next')).toBeDisabled();
    expect(screen.getByText('Previous')).not.toBeDisabled();
  });

  it('scrolls to top when changing page (window fallback when no scrollable ancestor)', async () => {
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(<Pagination page={0} totalPages={5} onPageChange={() => {}} />);
    await userEvent.click(screen.getByText('3'));
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    scrollSpy.mockRestore();
  });

  // The app's layout scrolls an inner <main class="overflow-y-auto"> container,
  // not the window — window.scrollTo is a no-op there. The component must scroll
  // the nearest scrollable ancestor instead.
  it('scrolls the nearest scrollable ancestor instead of the window', async () => {
    const windowSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const { container } = render(
      <main style={{ overflowY: 'auto' }}>
        <Pagination page={0} totalPages={5} onPageChange={() => {}} />
      </main>,
    );
    const scroller = container.querySelector('main') as HTMLElement;
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
    scroller.scrollTo = vi.fn();
    await userEvent.click(screen.getByText('3'));
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(windowSpy).not.toHaveBeenCalled();
    windowSpy.mockRestore();
  });

  it('does not re-fire onPageChange or scroll when clicking the active page', async () => {
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const onChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onPageChange={onChange} />);
    await userEvent.click(screen.getByText('3')); // page 2 displayed as "3" — already active
    expect(onChange).not.toHaveBeenCalled();
    expect(scrollSpy).not.toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('marks the active page with aria-current="page"', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByText('3')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('2')).not.toHaveAttribute('aria-current');
  });

  it('gives page buttons aria-labels and type="button"', () => {
    render(<Pagination page={0} totalPages={5} onPageChange={() => {}} />);
    const btn = screen.getByText('3');
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveAttribute('aria-label', 'Page 3');
  });
});
