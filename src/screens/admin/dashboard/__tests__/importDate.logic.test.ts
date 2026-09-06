import { parseImportDate } from '../importDate.logic';

// The whole reason this validation exists: `new Date(2026, 12, 40)` rolls
// over to a real date, so an unvalidated string matches zero sheet rows and
// the admin sees "No jobs found" with no hint the date itself was wrong.
describe('parseImportDate', () => {
  it('accepts a well-formed date and returns local midnight, not UTC', () => {
    const result = parseImportDate('2026-05-17');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.date.getFullYear()).toBe(2026);
    expect(result.date.getMonth()).toBe(4); // 0-indexed
    expect(result.date.getDate()).toBe(17);
  });

  it.each([
    ['2026-5-17', 'single-digit month'],
    ['26-05-17', 'two-digit year'],
    ['2026/05/17', 'slashes'],
    ['17-05-2026', 'day first'],
    ['', 'empty'],
    ['not a date', 'free text'],
  ])('rejects %s (%s) with the format message', (input) => {
    const result = parseImportDate(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.title).toBe('Invalid date');
    expect(result.message).toContain('YYYY-MM-DD');
  });

  it.each([
    ['2026-13-01', 'month 13'],
    ['2026-00-10', 'month 0'],
    ['2026-02-30', '30 February'],
    ['2026-04-31', '31 April'],
    ['2026-13-40', 'the rollover case that motivated this check'],
  ])('rejects %s (%s) as a date that does not exist', (input) => {
    const result = parseImportDate(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('does not exist');
  });

  it('accepts 29 February in a leap year but rejects it otherwise', () => {
    expect(parseImportDate('2028-02-29').ok).toBe(true);
    expect(parseImportDate('2026-02-29').ok).toBe(false);
  });
});
