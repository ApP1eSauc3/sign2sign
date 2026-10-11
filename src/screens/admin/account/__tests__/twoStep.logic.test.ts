import { qrImageUri, formatSecret, normaliseTotpInput, reauthKindFor } from '../twoStep.logic';

describe('qrImageUri', () => {
  it('wraps raw SVG markup in a percent-encoded data URI', () => {
    const uri = qrImageUri('<svg fill="#000"></svg>');
    expect(uri).toBe('data:image/svg+xml;utf8,%3Csvg%20fill%3D%22%23000%22%3E%3C%2Fsvg%3E');
    // '#' would otherwise end the URI at the fragment marker.
    expect(uri).not.toContain('#');
  });

  it('passes an existing data URI through unchanged', () => {
    expect(qrImageUri('data:image/svg+xml;utf-8,<svg/>')).toBe('data:image/svg+xml;utf-8,<svg/>');
  });
});

describe('formatSecret', () => {
  it('groups the key in fours', () => {
    expect(formatSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
  });

  it('leaves a short tail group and adds no trailing space', () => {
    expect(formatSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
  });

  it('ignores whitespace already present', () => {
    expect(formatSecret(' AB CD EF ')).toBe('ABCD EF');
  });
});

describe('normaliseTotpInput', () => {
  it.each([
    ['123 456', '123456'],
    ['123-456', '123456'],
    ['1234567', '123456'],
    ['', ''],
  ])('%p → %p', (input, expected) => {
    expect(normaliseTotpInput(input)).toBe(expected);
  });
});

describe('reauthKindFor', () => {
  it('asks for the password when the admin has no second factor', () => {
    expect(reauthKindFor(false, 'reauth_required')).toBe('password');
  });

  it('asks for the authenticator code when the admin has one', () => {
    expect(reauthKindFor(true, 'reauth_required')).toBe('code');
  });

  // The server knows best: if it says mfa_required, a password cannot satisfy it.
  it('always asks for the code when the server says mfa_required', () => {
    expect(reauthKindFor(false, 'mfa_required')).toBe('code');
  });
});
