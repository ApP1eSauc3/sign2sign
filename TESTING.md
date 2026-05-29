# Sign2Sign — Testing Strategy

This file defines what to test and what not to waste time on. A runner is installed and the priority suites exist — see **Status** below.

---

## Status

- **Runner:** `ts-jest` (node environment) — config in `jest.config.js`.
- **Run:** `npm test` (or `npm run test:watch`).
- **Coverage:** `src/stores/__tests__/useDriverSession.test.ts` and `src/services/__tests__/GoogleSheetsService.test.ts` (36 tests). These are the canonical, *accurate* examples — prefer them over the illustrative snippets further down, which predate the implementation and may not match current signatures.

## Setup (already done)

```bash
npm install -D jest ts-jest @types/jest
```

`jest.config.js`:

```js
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true, isolatedModules: true } }],
  },
  clearMocks: true,
};
```

### Runner choice — why `ts-jest`, not `jest-expo`

The high-value targets (stores, services) are pure TypeScript. We mock the service and Expo modules per-test so no native code loads, which keeps the suite fast (<1s) and stable on RN 0.83 / React 19 — where `jest-expo`'s React-Native transform is brittle. If/when we add **screen** rendering tests (see that section), introduce `jest-expo` + `@testing-library/react-native` in a second jest project; don't convert the store/service suites.

---

## What to test — by layer

### Data layer — nothing

Types and interfaces vanish at runtime. Zero value in testing them.

### Services layer — highest priority ✅

Services contain the most crash-prone logic: column mapping, data transformation, error handling, and API response parsing. Most of this is pure enough to test without hitting real network.

**What to test:**
- `GoogleSheetsService.importJobs` — row parsing, column mapping, blank row filtering, jobType normalisation
- `RouteCodeService` — response mapping (DB snake_case → domain camelCase), null/missing field handling
- `JobPhotoService.markJobComplete` — correct table/column update
- Error handling paths — Supabase error, 401 token expiry, network failure

**What to mock:**
- `supabase` — mock the client so tests don't hit the real DB
- `expo-secure-store` — mock SecureStore reads/writes
- `expo-image-manipulator` / `expo-image-picker` — mock at the module level

```typescript
// __mocks__/supabaseClient.ts
export const supabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  storage: {
    from: jest.fn().mockReturnThis(),
    upload: jest.fn(),
    createSignedUrl: jest.fn(),
  },
};
```

**Example — GoogleSheetsService row parsing:**

> ⚠️ Illustrative only — the real signature is `importJobs(sheetId, sheetName, importDate)` (it filters by date serial and geocodes each address), and unknown job types do **not** throw: `detectJobType` defaults to `'install'`. The snippet below is kept for shape; the accurate, passing version is `src/services/__tests__/GoogleSheetsService.test.ts`.

```typescript
// src/services/__tests__/GoogleSheetsService.test.ts
import { GoogleSheetsService } from '../GoogleSheetsService';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('fake-token'),
}));

global.fetch = jest.fn();

describe('GoogleSheetsService.importJobs', () => {
  it('maps sheet columns to SignJob fields correctly', async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        values: [
          ['Harcourts', 'Jane Smith', 'jane@harcourts.com.au', '42 Maple St', 'Corflute 900x600', 'install', '-33.8688', '151.2093', '1'],
        ],
      }),
    });

    const jobs = await GoogleSheetsService.importJobs('sheet-id-123');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      clientName: 'Harcourts',
      agentEmail: 'jane@harcourts.com.au',
      address: '42 Maple St',
      jobType: 'install',
      latitude: -33.8688,
      longitude: 151.2093,
      sortOrder: 1,
    });
  });

  it('skips rows with no address', async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        values: [
          ['Client', 'Agent', 'email@test.com', '', 'Sign', 'install', '0', '0', '1'],
          ['Client 2', 'Agent 2', 'email2@test.com', '10 Real St', 'Sign', 'removal', '0', '0', '2'],
        ],
      }),
    });

    const jobs = await GoogleSheetsService.importJobs('sheet-id-123');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].address).toBe('10 Real St');
  });

  it('throws on an unrecognised job type', async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        values: [['Client', '', '', '1 St', 'Sign', 'UNKNOWN', '0', '0', '1']],
      }),
    });

    await expect(GoogleSheetsService.importJobs('sheet-id-123')).rejects.toThrow(
      /invalid job type/i
    );
  });

  it('attempts token refresh on 401 before throwing', async () => {
    const { GoogleAuthService } = require('../GoogleAuthService');
    jest.spyOn(GoogleAuthService, 'refreshAccessToken').mockResolvedValue('new-token');

    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 401 }) // first call: expired
      .mockResolvedValueOnce({                            // second call: refreshed token works
        ok: true,
        status: 200,
        json: async () => ({ values: [] }),
      });

    await GoogleSheetsService.importJobs('sheet-id-123');
    expect(GoogleAuthService.refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});
```

### Stores layer — second priority ✅

Stores are pure TypeScript — no React, no RN. They're the easiest layer to test properly. The upload state machine and `canMarkComplete` are business-critical rules that should not break silently.

> ⚠️ Illustrative only — the real store uses `codeError`/`isLoadingSession` (not `error`/`isLoading`), `loadSession` returns a `boolean`, and there's a separate `markCompleteErrors` record. See `src/stores/__tests__/useDriverSession.test.ts` for the accurate, passing version.

**What to test:**
- `canMarkComplete` — returns false for every non-succeeded state
- State machine transitions — `idle → capturing → preview → uploading → succeeded/failed`
- `loadSession` — correctly seeds upload states from existing job data
- `flushOfflineQueue` — calls correct handlers for each operation type

```typescript
// src/stores/__tests__/useDriverSession.test.ts
import { useDriverSession } from '../useDriverSession';

// Reset store between tests
beforeEach(() => {
  useDriverSession.setState({
    session: null,
    uploadStates: {},
    codeError: null,
    isLoadingSession: false,
  });
});

describe('canMarkComplete', () => {
  it('returns false when upload state is idle', () => {
    useDriverSession.setState({
      uploadStates: { 'job-1': { status: 'idle' } },
    });
    expect(useDriverSession.getState().canMarkComplete('job-1')).toBe(false);
  });

  it('returns false when uploading', () => {
    useDriverSession.setState({
      uploadStates: { 'job-1': { status: 'uploading' } },
    });
    expect(useDriverSession.getState().canMarkComplete('job-1')).toBe(false);
  });

  it('returns true only when succeeded', () => {
    useDriverSession.setState({
      uploadStates: { 'job-1': { status: 'succeeded', photoKey: 'jobs/job-1/photo.jpg' } },
    });
    expect(useDriverSession.getState().canMarkComplete('job-1')).toBe(true);
  });

  it('returns false when job does not exist in upload states', () => {
    expect(useDriverSession.getState().canMarkComplete('nonexistent')).toBe(false);
  });
});

describe('loadSession — upload state seeding', () => {
  it('seeds succeeded state for jobs that already have a photo', async () => {
    // Mock RouteCodeService
    jest.mock('../../services/RouteCodeService', () => ({
      RouteCodeService: {
        loadSession: jest.fn().mockResolvedValue({
          routeCode: '123456',
          driverSlot: 1,
          jobs: [
            { id: 'job-1', isComplete: true, photoKey: 'jobs/job-1/photo.jpg', clientName: 'Test', address: '1 St', agentName: '', agentEmail: '', signDescription: '', jobType: 'install', latitude: 0, longitude: 0, sortOrder: 1 },
            { id: 'job-2', isComplete: false, photoKey: undefined, clientName: 'Test', address: '2 St', agentName: '', agentEmail: '', signDescription: '', jobType: 'removal', latitude: 0, longitude: 0, sortOrder: 2 },
          ],
        }),
      },
    }));

    await useDriverSession.getState().loadSession('123456');
    const { uploadStates } = useDriverSession.getState();

    expect(uploadStates['job-1']).toEqual({ status: 'succeeded', photoKey: 'jobs/job-1/photo.jpg' });
    expect(uploadStates['job-2']).toEqual({ status: 'idle' });
  });
});
```

### Utils layer — test pure functions only

`useNetworkStatus` polls hardware — skip it. `colors.ts` is a constant — skip it.

If you add a pure formatting function (e.g. a date formatter, an address truncation util), test it:

```typescript
// src/utils/__tests__/formatters.test.ts
import { truncateAddress } from '../formatters';

it('truncates long addresses at 40 chars', () => {
  expect(truncateAddress('123 Very Long Street Name That Goes On Forever, Suburb')).toBe(
    '123 Very Long Street Name That Goes On…'
  );
});
```

### Screens layer — integration tests only, sparingly

Screen unit tests are expensive to write and fragile. They test implementation details (which store method was called) rather than user-visible behaviour.

**Only write screen tests for:**
- A complete user flow that touches multiple states (e.g. photo capture → upload → mark complete)
- Regression tests for specific bugs that slipped through

**Never write screen tests for:**
- Rendering specific text or style values
- Whether a store action was called (test the store instead)
- Whether navigation happened (test the navigator separately)

```typescript
// src/screens/__tests__/DriverJobFlow.test.tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import DriverJobScreen from '../driver/DriverJobScreen';

// This is the kind of test worth writing: the full advancing button flow
it('photo gate: Mark Complete is disabled until photo upload succeeds', async () => {
  // Setup: store with idle state
  // Render screen
  // Assert: Mark Complete button does not exist
  // Trigger: press Take Photo
  // Assert: button shows Uploading...
  // Trigger: mock upload resolves
  // Assert: button shows Mark Complete and is enabled
});
```

---

## Mocking Expo modules

Expo modules need explicit mocks in `__mocks__/` or in `jest.mock()` calls. The `jest-expo` preset handles most, but these need manual setup:

```typescript
// jest.setup.ts
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: true }),
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn((uri) => Promise.resolve({ uri })),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: -33.8688, longitude: 151.2093 },
  }),
  Accuracy: { High: 5 },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
```

---

## Test file locations

Co-locate tests with the code they test:

```
src/
  services/
    GoogleSheetsService.ts
    __tests__/
      GoogleSheetsService.test.ts
  stores/
    useDriverSession.ts
    __tests__/
      useDriverSession.test.ts
  utils/
    __tests__/
      formatters.test.ts     ← only if pure formatters exist
```

---

## What NOT to test

| Thing | Why |
|---|---|
| TypeScript types and interfaces | They don't exist at runtime |
| `colors.ts` values | It's a constant — test your eyes |
| `useNetworkStatus` | Polls real hardware — integration test, not unit |
| Supabase RLS policies | Test these in the Supabase dashboard policy tester |
| Navigation transitions | High cost, low signal — test in the simulator |
| Exact pixel layout / styles | Fragile, never catches real bugs |
| Whether a `console.log` was called | Not a behaviour |

---

## Priority order

If you only have time to write some tests, write them in this order:

1. **`GoogleSheetsService.importJobs`** — column mapping bugs silently corrupt every job in a route
2. **`useDriverSession.canMarkComplete`** — the photo gate is the core business rule
3. **`useDriverSession` upload state transitions** — a wrong state transition means a driver can't complete a job
4. **`RouteCodeService.loadSession` response mapping** — a camelCase mapping bug means empty job lists

These are the failures that would send you to a job site to manually fix a driver's phone. Test them first.
