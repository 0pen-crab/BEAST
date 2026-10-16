import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'toast.errorTitle': 'Request failed',
        'toast.successTitle': 'Success',
        'toast.warningTitle': 'Warning',
        'common.dismiss': 'Dismiss',
      };
      return map[key] ?? key;
    },
  }),
}));

import { ToastProvider, useToast, toast } from './toast';

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children', () => {
    render(
      <ToastProvider>
        <div>App content</div>
      </ToastProvider>,
    );
    expect(screen.getByText('App content')).toBeInTheDocument();
  });

  it('shows an error toast fired outside React', () => {
    render(<ToastProvider>x</ToastProvider>);

    act(() => {
      toast.error('Something exploded');
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something exploded');
    expect(alert).toHaveTextContent('Request failed');
    expect(alert.className).toContain('beast-notification-error');
  });

  it('shows a success toast without the error styling', () => {
    render(<ToastProvider>x</ToastProvider>);

    act(() => {
      toast.success('Saved');
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Saved');
    expect(alert).toHaveTextContent('Success');
    expect(alert.className).not.toContain('beast-notification-error');
  });

  it('auto-dismisses after ~6 seconds', () => {
    render(<ToastProvider>x</ToastProvider>);

    act(() => {
      toast.error('Transient');
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6_500);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('dismisses manually via the close button', () => {
    render(<ToastProvider>x</ToastProvider>);

    act(() => {
      toast.error('Close me');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stacks multiple distinct messages', () => {
    render(<ToastProvider>x</ToastProvider>);

    act(() => {
      toast.error('First failure');
      toast.error('Second failure');
    });

    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('dedupes identical consecutive messages while one is visible', () => {
    render(<ToastProvider>x</ToastProvider>);

    act(() => {
      toast.error('Refetch storm');
      toast.error('Refetch storm');
      toast.error('Refetch storm');
    });

    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows the same message again after the previous toast is gone', () => {
    render(<ToastProvider>x</ToastProvider>);

    act(() => {
      toast.error('Recurring');
    });
    act(() => {
      vi.advanceTimersByTime(6_500);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => {
      toast.error('Recurring');
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Recurring');
  });

  it('does not throw when fired with no provider mounted', () => {
    expect(() => toast.error('Nobody is listening')).not.toThrow();
  });

  it('useToast returns the toast api inside the provider', () => {
    const { result } = renderHook(() => useToast(), {
      wrapper: ({ children }) => <ToastProvider>{children}</ToastProvider>,
    });
    expect(typeof result.current.error).toBe('function');
    expect(typeof result.current.success).toBe('function');
  });

  it('useToast throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useToast())).toThrow(
      'useToast must be used within ToastProvider',
    );
    spy.mockRestore();
  });

  describe('toast.show', () => {
    it('shows a warning toast with the warning style and default title', () => {
      render(<ToastProvider>x</ToastProvider>);

      act(() => {
        toast.warning('Disk almost full');
      });

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Warning');
      expect(alert).toHaveTextContent('Disk almost full');
      expect(alert.className).toContain('beast-notification-warning');
    });

    it('renders a custom title instead of the kind default', () => {
      render(<ToastProvider>x</ToastProvider>);

      act(() => {
        toast.show({ kind: 'error', title: 'Backend unreachable', message: 'boom' });
      });

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Backend unreachable');
      expect(alert).not.toHaveTextContent('Request failed');
    });

    it('renders one detail line per message when given an array', () => {
      render(<ToastProvider>x</ToastProvider>);

      act(() => {
        toast.show({ message: ['first issue', 'second issue'] });
      });

      const alert = screen.getByRole('alert');
      expect(alert.querySelectorAll('.beast-notification-detail')).toHaveLength(2);
      expect(alert).toHaveTextContent('first issue');
      expect(alert).toHaveTextContent('second issue');
    });

    it('does not auto-dismiss a persistent toast', () => {
      render(<ToastProvider>x</ToastProvider>);

      act(() => {
        toast.show({ message: 'Still here', persistent: true });
      });

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByRole('alert')).toHaveTextContent('Still here');
    });

    it('does not render a close button on persistent toasts', () => {
      render(<ToastProvider>x</ToastProvider>);

      act(() => {
        toast.show({ message: 'No close', persistent: true });
      });

      expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    });

    it('updates an existing toast in place when shown with the same id', () => {
      render(<ToastProvider>x</ToastProvider>);

      act(() => {
        toast.show({ id: 'health', message: 'Backend unreachable', persistent: true });
      });
      act(() => {
        toast.show({ id: 'health', message: 'Infrastructure issue', persistent: true });
      });

      const alerts = screen.getAllByRole('alert');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent('Infrastructure issue');
      expect(alerts[0]).not.toHaveTextContent('Backend unreachable');
    });

    it('dismisses a toast by id via toast.dismiss', () => {
      render(<ToastProvider>x</ToastProvider>);

      act(() => {
        toast.show({ id: 'health', message: 'Gone soon', persistent: true });
      });
      expect(screen.getByRole('alert')).toBeInTheDocument();

      act(() => {
        toast.dismiss('health');
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('returns a generated id usable with toast.dismiss', () => {
      render(<ToastProvider>x</ToastProvider>);

      let id = '';
      act(() => {
        id = toast.show({ message: 'Tracked', persistent: true });
      });
      expect(id).not.toBe('');

      act(() => {
        toast.dismiss(id);
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('renders an action button and invokes its handler', () => {
      render(<ToastProvider>x</ToastProvider>);

      const onClick = vi.fn();
      act(() => {
        toast.show({
          message: 'Backend down',
          persistent: true,
          action: { label: 'Retry', onClick },
        });
      });

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('resets the auto-dismiss timer when a non-persistent toast is updated by id', () => {
      render(<ToastProvider>x</ToastProvider>);

      act(() => {
        toast.show({ id: 'job', message: 'Working…' });
      });
      act(() => {
        vi.advanceTimersByTime(4_000);
      });
      act(() => {
        toast.show({ id: 'job', message: 'Almost done' });
      });
      // 4s after the update — original timer would have fired at 6s total
      act(() => {
        vi.advanceTimersByTime(4_000);
      });
      expect(screen.getByRole('alert')).toHaveTextContent('Almost done');

      act(() => {
        vi.advanceTimersByTime(2_500);
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
