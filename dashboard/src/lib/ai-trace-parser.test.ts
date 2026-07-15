import { describe, it, expect } from 'vitest';
import { parseStreamJsonl, summarizeTrace, waveLabel, isNoiseEvent, traceDownloadName } from './ai-trace-parser';

describe('parseStreamJsonl', () => {
  it('returns [] for empty content', () => {
    expect(parseStreamJsonl('')).toEqual([]);
  });

  it('extracts a prompt event', () => {
    const events = parseStreamJsonl('{"type":"prompt","content":"hello"}');
    expect(events).toEqual([{ kind: 'prompt', content: 'hello' }]);
  });

  it('extracts system, assistant blocks (text/thinking/tool_use), tool_result, result in order', () => {
    const jsonl = [
      '{"type":"system","subtype":"init","model":"claude-opus-4-7","cwd":"/work","tools":["bash","read"],"session_id":"s1"}',
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"let me think"},{"type":"text","text":"checking file"},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"file.ts","is_error":false}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"done"}]}}',
      '{"type":"result","is_error":false,"result":"ok","duration_ms":1234,"total_cost_usd":0.05,"num_turns":3}',
    ].join('\n');
    const events = parseStreamJsonl(jsonl);
    expect(events.map(e => e.kind)).toEqual([
      'system',
      'assistant',
      'tool_result',
      'assistant',
      'result',
    ]);
    const sys = events[0] as { kind: 'system'; model?: string; tools?: string[] };
    expect(sys.model).toBe('claude-opus-4-7');
    expect(sys.tools).toEqual(['bash', 'read']);
    const a1 = events[1] as { blocks: { kind: string; text?: string; name?: string }[] };
    expect(a1.blocks.map(b => b.kind)).toEqual(['thinking', 'text', 'tool_use']);
    expect(a1.blocks[0].text).toBe('let me think');
    expect(a1.blocks[2].name).toBe('Bash');
    const tr = events[2] as { content: string; isError: boolean };
    expect(tr.content).toBe('file.ts');
    expect(tr.isError).toBe(false);
    const res = events[4] as { isError: boolean; durationMs?: number; totalCostUsd?: number };
    expect(res.isError).toBe(false);
    expect(res.durationMs).toBe(1234);
    expect(res.totalCostUsd).toBe(0.05);
  });

  it('captures trace_error appended after stream', () => {
    const events = parseStreamJsonl('{"type":"trace_error","message":"API 401"}');
    expect(events[0]).toEqual({ kind: 'trace_error', message: 'API 401' });
  });

  it('marks unparseable lines as unknown', () => {
    const events = parseStreamJsonl('not-json\n{"type":"prompt","content":"x"}');
    expect(events[0].kind).toBe('unknown');
    expect(events[1].kind).toBe('prompt');
  });

  it('handles array-form tool_result content', () => {
    const jsonl = '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t","content":[{"type":"text","text":"line1"},{"type":"text","text":"line2"}],"is_error":true}]}}';
    const e = parseStreamJsonl(jsonl)[0] as { kind: string; content: string; isError: boolean };
    expect(e.kind).toBe('tool_result');
    expect(e.content).toBe('line1\nline2');
    expect(e.isError).toBe(true);
  });
});

describe('isNoiseEvent', () => {
  it('flags rate_limit_event lines (SDK telemetry) as noise', () => {
    const [e] = parseStreamJsonl('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}');
    expect(e.kind).toBe('unknown');
    expect(isNoiseEvent(e)).toBe(true);
  });

  it('flags system thinking_tokens counters as noise', () => {
    const [e] = parseStreamJsonl('{"type":"system","subtype":"thinking_tokens","estimated_tokens":50}');
    expect(e.kind).toBe('system');
    expect(isNoiseEvent(e)).toBe(true);
  });

  it('keeps real events: prompt, init system, assistant, result, unparseable unknowns', () => {
    const events = parseStreamJsonl([
      '{"type":"prompt","content":"go"}',
      '{"type":"system","subtype":"init","model":"claude-opus-4-7"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
      '{"type":"result","is_error":false,"result":"ok"}',
      'not-json-garbage',
    ].join('\n'));
    for (const e of events) {
      expect(isNoiseEvent(e), `kind=${e.kind}`).toBe(false);
    }
  });
});

describe('traceDownloadName', () => {
  it('builds a human .jsonl filename from the wave label', () => {
    expect(traceDownloadName('Скаут · пачка 1')).toBe('Скаут - пачка 1.jsonl');
  });

  it('strips filesystem-hostile characters', () => {
    expect(traceDownloadName('Sniper: src/auth "core"')).toBe('Sniper- src-auth -core-.jsonl');
  });

  it('falls back to trace for an empty label', () => {
    expect(traceDownloadName('   ')).toBe('trace.jsonl');
  });
});

describe('summarizeTrace', () => {
  it('returns empty summary for empty content', () => {
    expect(summarizeTrace('')).toEqual({ eventCount: 0, result: null, hasTraceError: false });
  });

  it('counts one event per non-empty line (matching parseStreamJsonl)', () => {
    const jsonl = [
      '{"type":"prompt","content":"go"}',
      '',
      'not-json',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
      '  ',
    ].join('\n');
    const summary = summarizeTrace(jsonl);
    expect(summary.eventCount).toBe(3);
    expect(summary.eventCount).toBe(parseStreamJsonl(jsonl).length);
    expect(summary.result).toBeNull();
    expect(summary.hasTraceError).toBe(false);
  });

  it('extracts the final result event without parsing every line', () => {
    const jsonl = [
      '{"type":"prompt","content":"go"}',
      '{"type":"result","is_error":false,"result":"ok","duration_ms":4200,"model":"claude-opus-4-7"}',
    ].join('\n');
    const summary = summarizeTrace(jsonl);
    expect(summary.result).not.toBeNull();
    expect(summary.result?.isError).toBe(false);
    expect(summary.result?.durationMs).toBe(4200);
    expect(summary.result?.model).toBe('claude-opus-4-7');
  });

  it('detects trace_error', () => {
    const summary = summarizeTrace('{"type":"prompt","content":"x"}\n{"type":"trace_error","message":"API 401"}');
    expect(summary.hasTraceError).toBe(true);
  });

  it('ignores a "type":"result" marker embedded inside string content', () => {
    const prompt = JSON.stringify({ type: 'prompt', content: 'see {"type":"result"} in docs' });
    const summary = summarizeTrace(prompt);
    expect(summary.result).toBeNull();
    expect(summary.hasTraceError).toBe(false);
    expect(summary.eventCount).toBe(1);
  });
});

describe('waveLabel', () => {
  it('maps known wave keys to i18n keys', () => {
    expect(waveLabel('wave1')).toEqual({ key: 'repo.aiTrace.wave.wave1' });
    expect(waveLabel('wave3')).toEqual({ key: 'repo.aiTrace.wave.wave3' });
    expect(waveLabel('report')).toEqual({ key: 'repo.aiTrace.wave.report' });
    expect(waveLabel('analyzer')).toEqual({ key: 'repo.aiTrace.wave.analyzer' });
    expect(waveLabel('scanner')).toEqual({ key: 'repo.aiTrace.wave.scanner' });
    expect(waveLabel('triage-report')).toEqual({ key: 'repo.aiTrace.wave.triageReport' });
    expect(waveLabel('mitigation-check')).toEqual({ key: 'repo.aiTrace.wave.mitigationCheck' });
  });

  it('maps parameterised wave keys with interpolation params', () => {
    expect(waveLabel('wave2-injection')).toEqual({ key: 'repo.aiTrace.wave.wave2', params: { name: 'Injection' } });
    expect(waveLabel('wave4-chain_auth')).toEqual({ key: 'repo.aiTrace.wave.wave4', params: { name: 'chain_auth' } });
    expect(waveLabel('scout-unclear-2')).toEqual({ key: 'repo.aiTrace.wave.scout', params: { batch: '2' } });
    expect(waveLabel('sniper-auth_module')).toEqual({ key: 'repo.aiTrace.wave.sniper', params: { name: 'auth module' } });
  });

  it('title-cases unknown keys as literal text', () => {
    expect(waveLabel('some-other-thing')).toEqual({ text: 'Some Other Thing' });
  });
});
