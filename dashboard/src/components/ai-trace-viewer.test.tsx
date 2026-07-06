import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';
import { parseStreamJsonl } from '@/lib/ai-trace-parser';
import { AiTraceViewer } from './ai-trace-viewer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const useAiTracesMock = vi.fn();

vi.mock('@/api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks')>();
  return {
    isScanActive: actual.isScanActive,
    useAiTraces: (id: number) => useAiTracesMock(id),
  };
});

// Spy-wrap the parser so we can assert collapsed waves are NOT parsed eagerly.
vi.mock('@/lib/ai-trace-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai-trace-parser')>();
  return {
    ...actual,
    parseStreamJsonl: vi.fn(actual.parseStreamJsonl),
  };
});

// Capture download calls (filename + blob) instead of touching the real DOM anchor.
const downloadBlobMock = vi.fn();
vi.mock('@/lib/export-findings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/export-findings')>();
  return {
    ...actual,
    downloadBlob: (...args: unknown[]) => downloadBlobMock(...args),
  };
});

const baseScan = {
  id: 'scan-1',
  scan_type: 'full',
  status: 'failed',
  target_url: 'https://example.com',
  started_at: '2026-05-22T19:10:40Z',
  completed_at: '2026-05-22T19:10:47Z',
  created_at: '2026-05-22T19:10:39Z',
  error: 'Wave1 classifier error: 401',
};

beforeEach(() => {
  vi.mocked(parseStreamJsonl).mockClear();
  downloadBlobMock.mockClear();
});

describe('AiTraceViewer', () => {
  it('renders empty state when there is no scan at all', () => {
    useAiTracesMock.mockReturnValue({ data: { scan: null, traces: [] }, isLoading: false, error: null });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    expect(screen.getByText('repo.aiTrace.emptyNoScan')).toBeInTheDocument();
  });

  it('renders empty-traces state when scan exists but recorded no traces', () => {
    useAiTracesMock.mockReturnValue({
      data: { scan: { ...baseScan, status: 'completed', error: null }, traces: [] },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    expect(screen.getByText('repo.aiTrace.emptyNoTraces')).toBeInTheDocument();
  });

  it('surfaces scan error in the header when present', () => {
    useAiTracesMock.mockReturnValue({
      data: { scan: baseScan, traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content: '', created_at: '' }] },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    expect(screen.getByText('Wave1 classifier error: 401')).toBeInTheDocument();
  });

  it('renders one wave block per trace and expands events on click', () => {
    const wave1Content = [
      '{"type":"prompt","content":"please verify"}',
      '{"type":"system","subtype":"init","model":"claude-sonnet-4-6"}',
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"checking"},{"type":"tool_use","id":"t1","name":"Read","input":{"path":"x.ts"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"function x(){}"}]}}',
      '{"type":"result","is_error":false,"result":"ok","duration_ms":4200,"total_cost_usd":0.02}',
    ].join('\n');
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'completed', error: null },
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content: wave1Content, created_at: '2026-05-22T19:11:00Z' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    // Header label is an i18n key resolved by the viewer
    expect(screen.getByText('repo.aiTrace.wave.wave1')).toBeInTheDocument();
    // First wave is open by default — events visible
    expect(screen.getByText('repo.aiTrace.prompt')).toBeInTheDocument();
    expect(screen.getByText('repo.aiTrace.thinking')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('repo.aiTrace.toolResult')).toBeInTheDocument();
    expect(screen.getByText('repo.aiTrace.completed')).toBeInTheDocument();
  });

  it('marks failed wave with failed status pill when trace_error is present', () => {
    const content = [
      '{"type":"prompt","content":"go"}',
      '{"type":"trace_error","message":"API 401"}',
    ].join('\n');
    useAiTracesMock.mockReturnValue({
      data: {
        scan: baseScan,
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content, created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    expect(screen.getByText('repo.aiTrace.status.failed')).toBeInTheDocument();
    expect(screen.getByText('repo.aiTrace.traceError')).toBeInTheDocument();
    expect(screen.getByText(/API 401/)).toBeInTheDocument();
  });

  it('collapses secondary waves by default, expands on click, and parses lazily', () => {
    const w1 = '{"type":"prompt","content":"a"}\n{"type":"result","is_error":false,"result":"ok"}';
    const w2 = '{"type":"prompt","content":"b"}\n{"type":"result","is_error":false,"result":"ok"}';
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'completed', error: null },
        traces: [
          { wave: 'wave1', file_name: 'wave1.jsonl', content: w1, created_at: '' },
          { wave: 'wave2-injection', file_name: 'wave2-injection.jsonl', content: w2, created_at: '' },
        ],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    // Wave 2 header visible
    const w2Header = screen.getByRole('button', { name: /wave\.wave2/ });
    expect(w2Header).toBeInTheDocument();
    // Wave 2 body initially hidden — prompt label for w2 not in DOM yet
    expect(screen.queryAllByText('repo.aiTrace.prompt')).toHaveLength(1); // only wave1
    // Collapsed waves are never fully parsed — only the open wave was
    expect(vi.mocked(parseStreamJsonl)).toHaveBeenCalledTimes(1);
    // Click to expand
    fireEvent.click(w2Header);
    expect(screen.queryAllByText('repo.aiTrace.prompt')).toHaveLength(2);
    expect(vi.mocked(parseStreamJsonl)).toHaveBeenCalledTimes(2);
  });

  it('pairs a tool_use with its tool_result into one nested unit', () => {
    const content = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"RESULT_BODY","is_error":false}]}}',
      '{"type":"result","is_error":false,"result":"done"}',
    ].join('\n');
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'completed', error: null },
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content, created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    // Result body renders INSIDE the tool block, not as a disconnected row
    const resultBody = screen.getByText('RESULT_BODY');
    expect(resultBody.closest('.beast-trace-event-tool')).not.toBeNull();
    expect(document.querySelectorAll('.beast-trace-event-tool-result')).toHaveLength(0);
    // The tool header carries the result status pill (wave header shows one too)
    expect(screen.getAllByText('repo.aiTrace.status.completed').length).toBeGreaterThanOrEqual(2);
  });

  it('shows an error status pill on the tool unit when its result is an error', () => {
    const content = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"boom","is_error":true}]}}',
      '{"type":"result","is_error":false,"result":"done"}',
    ].join('\n');
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'completed', error: null },
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content, created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    const failedPill = screen.getByText('repo.aiTrace.status.failed');
    expect(failedPill.closest('.beast-trace-event-tool')).not.toBeNull();
  });

  it('renders an orphan tool_result (no matching tool_use) as a standalone row', () => {
    const content = [
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"missing","content":"ORPHAN_BODY"}]}}',
      '{"type":"result","is_error":false,"result":"done"}',
    ].join('\n');
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'completed', error: null },
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content, created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    const orphan = screen.getByText('ORPHAN_BODY');
    expect(orphan.closest('.beast-trace-event-tool-result')).not.toBeNull();
  });

  it('marks an unanswered tool call as pending while the wave is still streaming', () => {
    const content = '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}';
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'running', error: null },
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content, created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    expect(screen.getByText('repo.aiTrace.toolPending')).toBeInTheDocument();
  });

  it('collapses long pre bodies behind a show more / show less toggle', () => {
    const longText = Array.from({ length: 30 }, (_, i) => `LINE_${i + 1}`).join('\n');
    const content = JSON.stringify({ type: 'prompt', content: longText });
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'completed', error: null },
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content, created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    // Preview shows the head of the body, tail is not in the DOM
    expect(screen.getByText(/LINE_1\b/)).toBeInTheDocument();
    expect(screen.queryByText(/LINE_30\b/)).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'repo.aiTrace.showMore' });
    fireEvent.click(toggle);
    expect(screen.getByText(/LINE_30\b/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'repo.aiTrace.showLess' }));
    expect(screen.queryByText(/LINE_30\b/)).not.toBeInTheDocument();
  });

  it('does not collapse short pre bodies', () => {
    const content = JSON.stringify({ type: 'prompt', content: 'short\nbody' });
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'completed', error: null },
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content, created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    expect(screen.queryByRole('button', { name: 'repo.aiTrace.showMore' })).not.toBeInTheDocument();
  });

  it('shows a live indicator and translated scan status while the scan runs', () => {
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'running', error: null },
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content: '{"type":"prompt","content":"a"}', created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    expect(screen.getAllByText('repo.aiTrace.live').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('status.running')).toBeInTheDocument();
  });

  it('hides the live indicator once the scan is terminal', () => {
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'completed', error: null },
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content: '{"type":"prompt","content":"a"}', created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    expect(screen.queryByText('repo.aiTrace.live')).not.toBeInTheDocument();
  });

  it('auto-expands the newest wave (not the first) while the scan is running', () => {
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'running', error: null },
        traces: [
          { wave: 'wave1', file_name: 'wave1.jsonl', content: '{"type":"prompt","content":"first-wave-prompt"}\n{"type":"result","is_error":false,"result":"ok"}', created_at: '2026-05-22T19:11:00Z' },
          { wave: 'wave3', file_name: 'wave3.jsonl', content: '{"type":"prompt","content":"second-wave-prompt"}', created_at: '2026-05-22T19:12:00Z' },
        ],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    expect(screen.getByText('second-wave-prompt')).toBeInTheDocument();
    expect(screen.queryByText('first-wave-prompt')).not.toBeInTheDocument();
  });

  it('downloads the raw trace under the human wave label, not the internal file name', () => {
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'completed', error: null },
        traces: [{ wave: 'scout-unclear-1', file_name: 'scout-unclear-1.jsonl', content: '{"type":"prompt","content":"a"}', created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'repo.aiTrace.downloadRaw' }));
    expect(downloadBlobMock).toHaveBeenCalledTimes(1);
    const [fileName, blob] = downloadBlobMock.mock.calls[0];
    // The mocked t() returns the key itself; the real UI resolves it to the
    // translated wave label (e.g. "Скаут · пачка 1.jsonl").
    expect(fileName).toBe('repo.aiTrace.wave.scout.jsonl');
    expect(fileName).not.toContain('scout-unclear');
    expect(blob).toBeInstanceOf(Blob);
  });

  it('hides rate_limit_event and thinking_tokens noise rows', () => {
    const content = [
      '{"type":"prompt","content":"real-prompt"}',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1}}',
      '{"type":"system","subtype":"thinking_tokens","estimated_tokens":50}',
      '{"type":"result","is_error":false,"result":"ok"}',
    ].join('\n');
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'completed', error: null },
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content, created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    expect(screen.getByText('repo.aiTrace.prompt')).toBeInTheDocument();
    expect(screen.queryByText(/rate_limit_event/)).not.toBeInTheDocument();
    expect(screen.queryByText(/thinking_tokens/)).not.toBeInTheDocument();
  });

  it('does not render the $ cost in the result banner (cost stays in the data)', () => {
    const content = [
      '{"type":"prompt","content":"go"}',
      '{"type":"result","is_error":false,"result":"ok","duration_ms":4200,"total_cost_usd":0.0234}',
    ].join('\n');
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'completed', error: null },
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content, created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    expect(screen.queryByText(/\$0\.02/)).not.toBeInTheDocument();
  });

  it('copies the raw trace to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const content = '{"type":"prompt","content":"a"}';
    useAiTracesMock.mockReturnValue({
      data: {
        scan: { ...baseScan, status: 'completed', error: null },
        traces: [{ wave: 'wave1', file_name: 'wave1.jsonl', content, created_at: '' }],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AiTraceViewer repositoryId={1} />);
    // Wrap in act so the async "copied" state flip is flushed
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'repo.aiTrace.copyRaw' }));
    });
    expect(writeText).toHaveBeenCalledWith(content);
  });
});

describe('AiTraceViewer i18n keys', () => {
  it('defines every new aiTrace key in both en and uk locales', async () => {
    const en = (await import('@/locales/en.json')).default as Record<string, any>;
    const uk = (await import('@/locales/uk.json')).default as Record<string, any>;
    const keys = [
      'live', 'system', 'tool', 'toolsCount', 'toolPending', 'traceError',
      'showMore', 'showLess', 'downloadRaw', 'copyRaw', 'copied',
    ];
    const waveKeys = [
      'wave1', 'wave2', 'wave3', 'wave4', 'report', 'analyzer', 'scanner',
      'triageReport', 'scout', 'sniper',
    ];
    for (const locale of [en, uk]) {
      const aiTrace = locale.repo.aiTrace;
      for (const k of keys) {
        expect(typeof aiTrace[k], `aiTrace.${k}`).toBe('string');
      }
      for (const k of waveKeys) {
        expect(typeof aiTrace.wave[k], `aiTrace.wave.${k}`).toBe('string');
      }
      for (const k of ['completed', 'failed', 'partial']) {
        expect(typeof aiTrace.status[k], `aiTrace.status.${k}`).toBe('string');
      }
    }
  });
});
