const {
  planSecuritySettings,
  hookFunctionPresent,
  HOOK_URI,
  DEFAULT_TIMEBOX_HOURS,
  DEFAULT_INACTIVITY_HOURS,
} = require('../securitySettings');

describe('planSecuritySettings', () => {
  it('defaults: 30-day overall limit (NIST AAL1 ceiling), 24h inactivity, hook on, live run', () => {
    expect(planSecuritySettings([])).toEqual({
      body: {
        sessions_timebox: 720,
        sessions_inactivity_timeout: 24,
        hook_custom_access_token_enabled: true,
        hook_custom_access_token_uri: 'pg-functions://postgres/public/custom_access_token_hook',
      },
      dryRun: false,
      enableHook: true,
    });
    expect(DEFAULT_TIMEBOX_HOURS).toBe(30 * 24);
    expect(DEFAULT_INACTIVITY_HOURS).toBe(24);
  });

  it('--dry-run is reported', () => {
    expect(planSecuritySettings(['--dry-run']).dryRun).toBe(true);
  });

  it('--skip-hook leaves the hook settings out entirely', () => {
    const plan = planSecuritySettings(['--skip-hook']);
    expect(plan.enableHook).toBe(false);
    expect(plan.body).toEqual({ sessions_timebox: 720, sessions_inactivity_timeout: 24 });
  });

  it('accepts NIST AAL2 values', () => {
    expect(planSecuritySettings(['--timebox-hours', '24', '--inactivity-hours', '1']).body)
      .toMatchObject({ sessions_timebox: 24, sessions_inactivity_timeout: 1 });
  });

  it.each([
    [['--inactivity-hours'], /needs a number of hours/],
    [['--inactivity-hours', 'abc'], /needs a number of hours/],
    [['--timebox-hours', '-1'], /needs a number of hours/],
    [['--timebox-hours', '9000'], /from 0 to 8760/],
    [['--timebox-hours', '24', '--inactivity-hours', '48'], /cannot be longer/],
  ])('rejects %p', (argv, message) => {
    expect(planSecuritySettings(argv).error).toMatch(message);
  });

  it('0 means "off" and does not trip the ordering check', () => {
    expect(planSecuritySettings(['--timebox-hours', '0', '--inactivity-hours', '48']).error).toBeUndefined();
  });

  it('points the hook at migration 016', () => {
    expect(HOOK_URI).toBe('pg-functions://postgres/public/custom_access_token_hook');
  });
});

describe('hookFunctionPresent', () => {
  it('is true only for a single row with present = true', () => {
    expect(hookFunctionPresent([{ present: true }])).toBe(true);
    expect(hookFunctionPresent([{ present: false }])).toBe(false);
    expect(hookFunctionPresent([])).toBe(false);
    expect(hookFunctionPresent(null)).toBe(false);
    expect(hookFunctionPresent({ present: true })).toBe(false);
  });
});
