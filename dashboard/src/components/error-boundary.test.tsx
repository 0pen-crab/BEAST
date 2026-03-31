import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './error-boundary';

// Component that throws on render
function ThrowingComponent({ message }: { message: string }): never {
  throw new Error(message);
}

// Safe component
function SafeComponent() {
  return <div>Safe content</div>;
}

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Suppress React error boundary console.error noise
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <SafeComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Safe content')).toBeInTheDocument();
  });

  it('renders default fallback when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Test error" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('renders custom fallback when provided and child throws', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <ThrowingComponent message="fail" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Custom error UI')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('renders a Retry button in default fallback', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="oops" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('resets error state when Retry is clicked (re-renders children)', () => {
    // We need a component that can be toggled between throwing and not throwing.
    // Since ErrorBoundary resets hasError to false, the children will re-render.
    // The ThrowingComponent will throw again, but let's verify the state reset happens.
    let shouldThrow = true;

    function ConditionalThrow() {
      if (shouldThrow) throw new Error('oops');
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Stop throwing before retry
    shouldThrow = false;

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('Recovered')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });
});
