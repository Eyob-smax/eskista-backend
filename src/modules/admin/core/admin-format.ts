/**
 * Small, pure helpers shared by the admin screens: CSV exports, labels, date buckets.
 */

/** "Export Summary". RFC 4180: quote every field that needs it, CRLF line ends. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    // A leading = + - @ turns a cell into a formula in Excel; prefix it so it stays text.
    const safe = /^[=+\-@]/.test(text) && typeof value !== 'number' ? `'${text}` : text;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Minor units to a plain decimal for spreadsheets: 1250050 → "12500.50". */
export function minorToDecimal(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** SCREAMING_CASE to "Title Case". */
export function humanise(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** "Good Morning" / "Good Afternoon" / "Good Evening" for Addis Ababa (UTC+3). */
export function greeting(now: Date = new Date()): string {
  const hour = (now.getUTCHours() + 3) % 24;
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

/** Percentage change, rounded; null when there is nothing to compare against. */
export function trendPercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}
