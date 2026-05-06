import { describe, it, expect } from 'vitest';
import {
  AI_INACTIVITY_TIMEOUT_MS, AI_MAX_TIMEOUT_MS,
  SCANNER_UID, SCANNER_GID,
  SOURCE_EXTENSIONS, EXCLUDED_DIRS, EXCLUDED_FILE_PATTERNS,
  type PipelineContext, type StepDef, type StepFn, type StepInput,
  type CloneOutput, type AnalysisOutput, type SecurityToolsOutput,
  type AiResearchOutput, type ImportOutput, type TriageReportOutput,
  type ToolResult, type ResultFile,
} from './pipeline-types.ts';

describe('pipeline-types', () => {
  it('exports timeout constants', () => {
    expect(AI_INACTIVITY_TIMEOUT_MS).toBe(20 * 60 * 1000);
    expect(AI_MAX_TIMEOUT_MS).toBe(60 * 60 * 1000);
  });

  it('exports scanner UID/GID constants', () => {
    expect(SCANNER_UID).toBe(1001);
    expect(SCANNER_GID).toBe(1001);
  });

  it('exports scan scope arrays', () => {
    expect(SOURCE_EXTENSIONS).toContain('.ts');
    expect(SOURCE_EXTENSIONS).toContain('.py');
    expect(SOURCE_EXTENSIONS).toContain('.go');
    expect(EXCLUDED_DIRS).toContain('node_modules');
    expect(EXCLUDED_DIRS).toContain('.git');
    expect(EXCLUDED_FILE_PATTERNS).toContain('*.min.js');
    expect(EXCLUDED_FILE_PATTERNS).toContain('package-lock.json');
  });

  it('StepFn type is assignable', () => {
    const fn: StepFn = async ({ ctx, prev }) => ({ done: true });
    expect(typeof fn).toBe('function');
  });

  it('StepDef type accepts a step definition', () => {
    const step: StepDef = {
      name: 'test-step',
      run: async () => ({}),
    };
    expect(step.name).toBe('test-step');
    expect(typeof step.run).toBe('function');
  });
});
