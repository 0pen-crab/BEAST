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
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { HealthNotification } from './health-notification';
import { apiFetch } from '@/api/client';

const apiFetchMock = vi.mocked(apiFetch);

const okResponse = () =>
  new Response(JSON.stringify({ status: 'ok' }), { status: 200 });

const failResponse = () =>
  new Response('upstream gone', { status: 502 });

describe('HealthNotification', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when /api/health responds ok', async () => {
    apiFetchMock.mockResolvedValue(okResponse());
    render(<HealthNotification />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(screen.queryByText('Backend unreachable')).not.toBeInTheDocument();
  });

  it('shows notification when /api/health returns non-2xx', async () => {
    apiFetchMock.mockResolvedValue(failResponse());
    render(<HealthNotification />);
    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument();
  });

  it('shows infrastructure issue messages when /api/health returns 503 with issues', async () => {
    const degraded = new Response(
      JSON.stringify({
        status: 'degraded',
        issues: [
          { message: 'Cannot reach security-tools: All configured authentication methods failed', source: 'infra-check' },
          { message: 'Cannot reach claude-runner: connection refused', source: 'infra-check' },
        ],
      }),
      { status: 503 },
    );
    apiFetchMock.mockResolvedValue(degraded);

    render(<HealthNotification />);
    expect(await screen.findByText('Infrastructure issue')).toBeInTheDocument();
    expect(await screen.findByText(/security-tools.*authentication methods failed/)).toBeInTheDocument();
    expect(await screen.findByText(/claude-runner.*connection refused/)).toBeInTheDocument();
    // Generic detail text is hidden when specific issues are shown
    expect(screen.queryByText('API health check failed.')).not.toBeInTheDocument();
  });

  it('shows notification when apiFetch throws (network error)', async () => {
    apiFetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    render(<HealthNotification />);
    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument();
  });

  it('disappears after a successful retry', async () => {
    apiFetchMock
      .mockResolvedValueOnce(failResponse())
      .mockResolvedValueOnce(okResponse());

    render(<HealthNotification />);
    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(screen.queryByText('Backend unreachable')).not.toBeInTheDocument(),
    );
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses /api/health as the endpoint', async () => {
    apiFetchMock.mockResolvedValue(okResponse());
    render(<HealthNotification />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith('/api/health');
  });

  it('polls /api/health on a 10s interval', async () => {
    apiFetchMock.mockResolvedValue(okResponse());
    vi.useFakeTimers();

    render(<HealthNotification />);
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
});
