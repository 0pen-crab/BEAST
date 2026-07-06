import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'health.title': 'Backend unreachable',
        'health.degradedTitle': 'Infrastructure issue',
        'health.detail': 'API health check failed.',
        'health.retry': 'Retry',
        'health.systems.db': 'Database',
        'health.systems.worker': 'Worker',
        'health.systems.claude-runner': 'Claude runner',
        'health.systems.security-tools': 'Security tools',
        'toast.errorTitle': 'Request failed',
        'common.dismiss': 'Dismiss',
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { HealthNotification } from './health-notification';
import { ToastProvider, toast } from '@/lib/toast';
import { apiFetch } from '@/api/client';

const apiFetchMock = vi.mocked(apiFetch);

const okResponse = () =>
  new Response(JSON.stringify({ status: 'ok' }), { status: 200 });

const failResponse = () =>
  new Response('upstream gone', { status: 502 });

function renderHealth() {
  return render(
    <ToastProvider>
      <HealthNotification />
    </ToastProvider>,
  );
}

describe('HealthNotification', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when /api/health responds ok', async () => {
    apiFetchMock.mockResolvedValue(okResponse());
    renderHealth();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(screen.queryByText('Backend unreachable')).not.toBeInTheDocument();
  });

  it('is headless — renders no DOM of its own', async () => {
    apiFetchMock.mockResolvedValue(okResponse());
    const { container } = render(<HealthNotification />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows notification when /api/health returns non-2xx', async () => {
    apiFetchMock.mockResolvedValue(failResponse());
    renderHealth();
    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument();
  });

  it('shows one line per failed system when /api/health returns 503 with failures', async () => {
    const degraded = new Response(
      JSON.stringify({
        status: 'degraded',
        failures: [
          { system: 'security-tools', message: 'Cannot reach security-tools: All configured authentication methods failed' },
          { system: 'claude-runner', message: 'Cannot reach claude-runner: connection refused' },
        ],
      }),
      { status: 503 },
    );
    apiFetchMock.mockResolvedValue(degraded);

    renderHealth();
    expect(await screen.findByText('Infrastructure issue')).toBeInTheDocument();
    // Each line is prefixed with the localized system label
    expect(await screen.findByText(/^Security tools: .*authentication methods failed/)).toBeInTheDocument();
    expect(await screen.findByText(/^Claude runner: .*connection refused/)).toBeInTheDocument();
    // Generic detail text is hidden when specific failures are shown
    expect(screen.queryByText('API health check failed.')).not.toBeInTheDocument();
  });

  it('shows worker and db failures with localized system labels', async () => {
    const down = new Response(
      JSON.stringify({
        status: 'down',
        failures: [
          { system: 'db', message: 'Database is unreachable: connect ECONNREFUSED' },
        ],
      }),
      { status: 503 },
    );
    const workerDegraded = new Response(
      JSON.stringify({
        status: 'degraded',
        failures: [
          { system: 'worker', message: 'Worker has never reported a heartbeat — the worker container is not running' },
        ],
      }),
      { status: 503 },
    );
    apiFetchMock.mockResolvedValueOnce(down).mockResolvedValueOnce(workerDegraded);

    renderHealth();
    expect(await screen.findByText(/^Database: .*unreachable/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/^Worker: .*never reported a heartbeat/)).toBeInTheDocument();
    expect(screen.queryByText(/^Database:/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows notification when apiFetch throws (network error)', async () => {
    apiFetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    renderHealth();
    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument();
  });

  it('keeps the banner up past the toast auto-dismiss window', async () => {
    apiFetchMock.mockResolvedValue(failResponse());
    vi.useFakeTimers();

    renderHealth();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Backend unreachable')).toBeInTheDocument();

    // Well past the 6s auto-dismiss of regular toasts (health stays unhealthy)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(screen.getByText('Backend unreachable')).toBeInTheDocument();
  });

  it('updates a single banner instead of stacking when health state changes', async () => {
    apiFetchMock
      .mockResolvedValueOnce(failResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'degraded',
            failures: [{ system: 'claude-runner', message: 'Cannot reach claude-runner: timeout' }],
          }),
          { status: 503 },
        ),
      );

    renderHealth();
    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Infrastructure issue')).toBeInTheDocument();
    expect(screen.queryByText('Backend unreachable')).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('disappears after a successful retry', async () => {
    apiFetchMock
      .mockResolvedValueOnce(failResponse())
      .mockResolvedValueOnce(okResponse());

    renderHealth();
    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(screen.queryByText('Backend unreachable')).not.toBeInTheDocument(),
    );
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one notification stack with regular error toasts', async () => {
    apiFetchMock.mockResolvedValue(failResponse());

    const { container } = renderHealth();
    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument();

    act(() => {
      toast.error('Request exploded');
    });

    expect(container.querySelectorAll('.beast-notification-stack')).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('uses /api/health as the endpoint', async () => {
    apiFetchMock.mockResolvedValue(okResponse());
    renderHealth();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith('/api/health');
  });

  it('polls /api/health on a 10s interval', async () => {
    apiFetchMock.mockResolvedValue(okResponse());
    vi.useFakeTimers();

    renderHealth();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
  });

  it('dismisses the health banner when unmounted', async () => {
    apiFetchMock.mockResolvedValue(failResponse());
    const { unmount } = renderHealth();
    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument();

    unmount();
    expect(screen.queryByText('Backend unreachable')).not.toBeInTheDocument();
  });
});
