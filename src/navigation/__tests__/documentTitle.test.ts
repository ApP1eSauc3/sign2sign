import { formatDocumentTitle, APP_TITLE } from '../documentTitle';

describe('formatDocumentTitle', () => {
  it('shows the app name when there is no route (mode select renders outside a navigator)', () => {
    expect(formatDocumentTitle(undefined, undefined)).toBe('Sign2Site');
  });

  it('never shows a raw route name', () => {
    expect(formatDocumentTitle({}, { key: 'k', name: 'AdminDashboard' })).toBe(APP_TITLE);
  });

  it('prefixes a screen title when a screen sets one', () => {
    expect(formatDocumentTitle({ title: 'Account' }, { key: 'k', name: 'Account' })).toBe('Account – Sign2Site');
  });
});
