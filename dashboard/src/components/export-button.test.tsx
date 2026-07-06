import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportButton } from './export-button';
import { apiFetch } from '@/api/client';
import { downloadBlob } from '@/lib/export-findings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/lib/workspace', () => ({
  useWorkspace: () => ({ currentWorkspace: { id: 1 } }),
}));

vi.mock('@/api/hooks', () => ({
  useFindingCountsByTool: () => ({ data: [] }),
}));

vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/export-findings', () => ({
  downloadBlob: vi.fn(),
  generateFindingsMarkdown: vi.fn(() => 'md'),
  generateFindingsCsv: vi.fn(() => 'csv'),
  downloadAsZip: vi.fn(),
}));

// Stub the dialog: expose a button that triggers the raw export callback.
vi.mock('@/components/export-dialog', () => ({
  ExportDialog: ({ open, onExport }: { open: boolean; onExport: (s: string[], t: string[], st: string[], f: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onExport(['High'], ['beast'], ['open'], 'csv')}>
        DO_RAW_EXPORT
      </button>
    ) : null,
}));

const apiFetchMock = vi.mocked(apiFetch);
const downloadBlobMock = vi.mocked(downloadBlob);

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

function mockLatestOk() {
  // Mount effect: no in-flight AI job.
  apiFetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/highlights/latest')) return okJson({ job: null });
    throw new Error(`unexpected call: ${url}`);
  });
}

async function startRawExport() {
  render(<ExportButton scope={{ type: 'repo', repositoryId: 7, repositoryName: 'my-repo' }} />);
  fireEvent.click(screen.getByText('Export'));
  fireEvent.click(await screen.findByText('DO_RAW_EXPORT'));
}

describe('ExportButton raw export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('terminates when the API returns an empty results page (count > collected)', async () => {
    mockLatestOk();
    apiFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/highlights/latest')) return okJson({ job: null });
      // Malformed backend: count says 10 but no results — must not loop forever.
      if (url.includes('/api/findings')) return okJson({ count: 10, results: [] });
      throw new Error(`unexpected call: ${url}`);
    });

    await startRawExport();

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1));
    // Only one findings page requested — the empty page broke the loop.
    const findingCalls = apiFetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/findings'));
    expect(findingCalls).toHaveLength(1);
  });

  it('surfaces an error instead of downloading a truncated file when a page fetch fails', async () => {
    apiFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/highlights/latest')) return okJson({ job: null });
      if (url.includes('/api/findings')) return { ok: false, status: 500 } as unknown as Response;
      throw new Error(`unexpected call: ${url}`);
    });

    await startRawExport();

    await waitFor(() => expect(screen.getByText('Export failed')).toBeInTheDocument());
    expect(downloadBlobMock).not.toHaveBeenCalled();
  });

  it('error message can be dismissed', async () => {
    apiFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/highlights/latest')) return okJson({ job: null });
      if (url.includes('/api/findings')) return { ok: false, status: 500 } as unknown as Response;
      throw new Error(`unexpected call: ${url}`);
    });

    await startRawExport();
    await waitFor(() => expect(screen.getByText('Export failed')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText('Export failed')).toBeNull();
  });

  it('shows a preparing state and disables the button while the raw export runs', async () => {
    let resolveFindings!: (value: Response) => void;
    const pending = new Promise<Response>((r) => { resolveFindings = r; });
    apiFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/highlights/latest')) return okJson({ job: null });
      if (url.includes('/api/findings')) return pending;
      throw new Error(`unexpected call: ${url}`);
    });

    await startRawExport();

    // While the findings request is in flight, the button shows progress and is disabled.
    const btn = await screen.findByText('Preparing export…');
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    resolveFindings(okJson({ count: 1, results: [{ id: 1, repositoryName: 'my-repo' }] }));
    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1));
    // Button returns to idle
    await waitFor(() => expect(screen.getByText('Export')).toBeInTheDocument());
    expect((screen.getByText('Export') as HTMLButtonElement).disabled).toBe(false);
  });
});
