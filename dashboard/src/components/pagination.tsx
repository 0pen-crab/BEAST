import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface PaginationProps {
  /** 0-indexed current page */
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/** Sliding window of 5 page indices (0-indexed). Matches repos page logic. */
function paginationRange(current: number, total: number): (number | '...')[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i);
  const pages: (number | '...')[] = [];
  let start: number, end: number;
  if (current <= 2) { start = 0; end = 4; }
  else if (current >= total - 3) { start = total - 5; end = total - 1; }
  else { start = current - 2; end = current + 2; }
  if (start > 0) pages.push('...');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('...');
  return pages;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);

  if (totalPages <= 1) return null;

  // The app's layout scrolls an inner container (<main class="overflow-y-auto">),
  // not the window — window.scrollTo is a no-op there. Scroll the nearest
  // scrollable ancestor and fall back to the window.
  const scrollToTop = () => {
    let el: HTMLElement | null = rootRef.current?.parentElement ?? null;
    while (el) {
      const { overflowY } = window.getComputedStyle(el);
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        el.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      el = el.parentElement;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Change page and bring the user back to the top of the results.
  // No-op when the target is already the current page.
  const goTo = (target: number) => {
    if (target === page) return;
    onPageChange(target);
    scrollToTop();
  };

  return (
    <>
      <div className="beast-pagination" ref={rootRef}>
        <button
          type="button"
          className="beast-pagination-btn"
          disabled={page === 0}
          onClick={() => goTo(0)}
        >
          {t('common.first')}
        </button>
        <button
          type="button"
          className="beast-pagination-btn"
          disabled={page === 0}
          onClick={() => goTo(page - 1)}
        >
          {t('common.previous')}
        </button>

        {paginationRange(page, totalPages).map((item, i) =>
          item === '...' ? (
            <span key={`e${i}`} className="beast-pagination-ellipsis">&hellip;</span>
          ) : (
            <button
              key={item}
              type="button"
              className={cn('beast-pagination-btn', page === item && 'beast-pagination-active')}
              aria-label={`${t('common.page')} ${(item as number) + 1}`}
              aria-current={page === item ? 'page' : undefined}
              onClick={() => goTo(item as number)}
            >
              {(item as number) + 1}
            </button>
          ),
        )}

        <button
          type="button"
          className="beast-pagination-btn"
          disabled={page >= totalPages - 1}
          onClick={() => goTo(page + 1)}
        >
          {t('common.next')}
        </button>
        <button
          type="button"
          className="beast-pagination-btn"
          disabled={page >= totalPages - 1}
          onClick={() => goTo(totalPages - 1)}
        >
          {t('common.last')}
        </button>
      </div>
      <div className="beast-pagination-info-wrap">
        <span className="beast-pagination-info">
          {t('common.page')} {page + 1} {t('common.of')} {totalPages}
        </span>
      </div>
    </>
  );
}
