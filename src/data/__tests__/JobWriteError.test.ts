import { JobWriteError, jobWriteErrorCode } from '../JobWriteError';

// TESTING.md says the data layer needs no tests because types vanish at
// runtime. That holds for interfaces and type aliases. This module is the
// exception: it ships a class and a narrowing function, both of which run, and
// the store branches on the result to decide whether a driver is told "it will
// retry" or "tell dispatch, this work may never be recorded".

describe('JobWriteError', () => {
  it('is a real Error carrying both a readable message and a stable code', () => {
    const err = new JobWriteError('invalid_route_code', 'Your route code is no longer valid.');

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('invalid_route_code');
    expect(err.message).toBe('Your route code is no longer valid.');
    expect(err.name).toBe('JobWriteError');
  });

  it('survives being thrown and caught as unknown', () => {
    try {
      throw new JobWriteError('job_not_found', 'Gone.');
    } catch (err: unknown) {
      expect(jobWriteErrorCode(err)).toBe('job_not_found');
    }
  });
});

describe('jobWriteErrorCode', () => {
  it('reads the code off a JobWriteError', () => {
    expect(jobWriteErrorCode(new JobWriteError('photo_required', 'x'))).toBe('photo_required');
  });

  // The reason this is a property read and not `instanceof`: a bundler can end
  // up with two copies of the class, and `instanceof` then silently reports a
  // real JobWriteError as "some other failure".
  it('reads the code off a structurally identical object from another realm', () => {
    expect(jobWriteErrorCode({ code: 'invalid_route_code', message: 'x' })).toBe('invalid_route_code');
  });

  it.each([
    ['a plain Error (transport failure)', new Error('network down')],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'invalid_route_code'],
    ['a number', 42],
    ['an object with no code', { message: 'x' }],
    ['a non-string code', { code: 500 }],
  ])('returns undefined for %s', (_label, value) => {
    expect(jobWriteErrorCode(value)).toBeUndefined();
  });

  // Supabase's own PostgrestError also carries a string `code` (e.g. '23505').
  // That is fine and intentional — an unrecognised code falls through to the
  // generic branch — but it must not throw.
  it('does not choke on an unrelated error that happens to have a code', () => {
    expect(jobWriteErrorCode({ code: '23505', message: 'duplicate key' })).toBe('23505');
  });
});
