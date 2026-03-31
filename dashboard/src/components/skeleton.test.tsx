import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton, CardSkeleton, TableSkeleton, PageSkeleton } from './skeleton';

describe('Skeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelector('div')).toBeInTheDocument();
  });

  it('includes beast-skeleton class', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild?.className).toContain('beast-skeleton');
  });

  it('applies custom className', () => {
    const { container } = render(<Skeleton className="h-8 w-full" />);
    const el = container.firstElementChild;
    expect(el?.className).toContain('h-8');
    expect(el?.className).toContain('w-full');
  });
});

describe('CardSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<CardSkeleton />);
    expect(container.firstElementChild).toBeInTheDocument();
  });
});

describe('TableSkeleton', () => {
  it('renders default 5 rows plus a header', () => {
    const { container } = render(<TableSkeleton />);
    const skeletons = container.querySelectorAll('.beast-skeleton');
    expect(skeletons.length).toBe(6);
  });

  it('renders custom number of rows', () => {
    const { container } = render(<TableSkeleton rows={3} />);
    const skeletons = container.querySelectorAll('.beast-skeleton');
    expect(skeletons.length).toBe(4);
  });
});

describe('PageSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<PageSkeleton />);
    expect(container.firstElementChild).toBeInTheDocument();
  });

  it('contains multiple skeleton elements', () => {
    const { container } = render(<PageSkeleton />);
    const skeletons = container.querySelectorAll('.beast-skeleton');
    expect(skeletons.length).toBeGreaterThan(5);
  });
});
