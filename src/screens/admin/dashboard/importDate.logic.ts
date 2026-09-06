// Import-date validation, extracted from AdminDashboardScreen so it can be
// tested without rendering a screen.
//
// Validate YYYY-MM-DD strictly. Without this, "2026-13-40" rolls over to
// a valid Date object that silently matches zero rows and the user just
// sees "No jobs found" with no hint that the date itself was malformed.
export type ImportDateResult =
  | { ok: true; date: Date }
  | { ok: false; title: string; message: string };

export function parseImportDate(importDate: string): ImportDateResult {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(importDate);
  if (!match) {
    return {
      ok: false,
      title: 'Invalid date',
      message: 'Use the format YYYY-MM-DD (e.g. 2026-05-17).',
    };
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dateObj = new Date(y, m - 1, d);
  if (
    dateObj.getFullYear() !== y ||
    dateObj.getMonth() !== m - 1 ||
    dateObj.getDate() !== d
  ) {
    return {
      ok: false,
      title: 'Invalid date',
      message: 'That date does not exist — check month and day.',
    };
  }
  return { ok: true, date: dateObj };
}
