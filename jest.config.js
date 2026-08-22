/**
 * ts-jest (node env), not jest-expo: the test targets are pure store/service
 * logic. Service + expo modules are mocked per-test so no native code loads,
 * which keeps the suite fast and stable on RN 0.83 / React 19. See TESTING.md.
 */
// Pin the timezone. Several business rules are LOCAL-calendar rules, not UTC
// ones — `created_date` on a route code is a Perth business-day label, and the
// bug that motivated `localDateString()` was a code generated at 07:00 Perth
// being stamped with yesterday's UTC date. A test asserting that only means
// something if the runner's clock is somewhere UTC and local actually differ,
// so CI and a laptop in Perth must agree.
process.env.TZ = 'Australia/Perth';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: { module: 'commonjs', esModuleInterop: true, isolatedModules: true } },
    ],
  },
  clearMocks: true,
};
