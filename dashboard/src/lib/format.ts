function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Format as DD.MM.YYYY */
export function formatDate(input: string | number | Date): string {
  const d = new Date(input);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format as "Mar 15" (or "Mar 15, 2025" if not current year) */
export function formatDateShort(input: string | number | Date): string {
  const d = new Date(input);
  const month = SHORT_MONTHS[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  if (year !== new Date().getFullYear()) {
    return `${month} ${day}, ${year}`;
  }
  return `${month} ${day}`;
}

/** Format as DD.MM.YYYY HH:mm */
export function formatDateTime(input: string | number | Date): string {
  const d = new Date(input);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Format as HH:mm:ss */
export function formatTime(input: string | number | Date): string {
  const d = new Date(input);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return unitIndex === 0
    ? `${value} ${units[unitIndex]}`
    : `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** Format large numbers compactly: 1234 -> "1.2K", 1234567 -> "1.2M" */
export function formatCompact(n: number | null | undefined): string {
  if (n == null) return '\u2014';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
