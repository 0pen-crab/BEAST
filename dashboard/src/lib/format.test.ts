import { describe, it, expect } from 'vitest';
import { formatBytes, formatDate, formatDateTime, formatTime } from './format';

describe('formatBytes', () => {
  it('returns "—" for null/undefined', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
  });

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(150 * 1024 * 1024)).toBe('150.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1.0 GB');
    expect(formatBytes(2.3 * 1024 * 1024 * 1024)).toBe('2.3 GB');
  });

  it('formats zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });
});

describe('formatDate', () => {
  it('formats ISO string as DD.MM.YYYY', () => {
    expect(formatDate('2025-08-31T12:00:00Z')).toMatch(/^\d{2}\.08\.2025$/);
  });

  it('pads single-digit day and month', () => {
    expect(formatDate('2025-01-05T00:00:00')).toMatch(/^05\.01\.2025$/);
  });

  it('accepts Date object', () => {
    expect(formatDate(new Date(2019, 6, 12))).toBe('12.07.2019');
  });

  it('accepts timestamp number', () => {
    const ts = new Date(2026, 2, 18).getTime();
    expect(formatDate(ts)).toBe('18.03.2026');
  });
});

describe('formatDateTime', () => {
  it('formats as DD.MM.YYYY HH:mm', () => {
    expect(formatDateTime(new Date(2025, 7, 31, 14, 5))).toBe('31.08.2025 14:05');
  });

  it('pads hours and minutes', () => {
    expect(formatDateTime(new Date(2025, 0, 1, 3, 7))).toBe('01.01.2025 03:07');
  });
});

describe('formatTime', () => {
  it('formats as HH:mm:ss', () => {
    expect(formatTime(new Date(2025, 7, 31, 14, 5, 9))).toBe('14:05:09');
  });

  it('pads hours, minutes and seconds', () => {
    expect(formatTime(new Date(2025, 0, 1, 3, 7, 2))).toBe('03:07:02');
  });
});
