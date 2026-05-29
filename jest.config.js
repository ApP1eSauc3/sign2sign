/**
 * ts-jest (node env), not jest-expo: the test targets are pure store/service
 * logic. Service + expo modules are mocked per-test so no native code loads,
 * which keeps the suite fast and stable on RN 0.83 / React 19. See TESTING.md.
 */
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
