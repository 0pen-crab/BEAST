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

  if (totalPages <= 1) return null;

  return (
    <>
      <div className="beast-pagination">
        <button
          className="beast-pagination-btn"
          disabled={page === 0}
          onClick={() => onPageChange(0)}
        >
          {t('common.first')}
        </button>

        {paginationRange(page, totalPages).map((item, i) =>
          item === '...' ? (
            <span key={`e${i}`} className="beast-pagination-ellipsis">&hellip;</span>
          ) : (
            <button
              key={item}
              className={cn('beast-pagination-btn', page === item && 'beast-pagination-active')}
              onClick={() => onPageChange(item as number)}
            >
              {(item as number) + 1}
            </button>
          ),
        )}

        <button
          className="beast-pagination-btn"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(totalPages - 1)}
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
