import * as Crypto from 'expo-crypto';

// Cryptographic randomness, wrapped so no caller depends on a global that may
// not exist.
//
// `crypto.randomUUID` and `crypto.getRandomValues` are browser APIs. They are
// present in the Electron renderer and in Expo web, so every admin flow on
// desktop worked — but React Native's Hermes runtime installs no `crypto`
// global at all. Verified against this project's own dependencies on
// 2026-09-03: React Native 0.83.2 contains no reference to `getRandomValues`
// anywhere, and Expo 55's winter runtime installs TextDecoder, URL,
// URLSearchParams and structuredClone — no crypto.
//
// Two call sites depended on that global, and both were wrong:
//
//   1. `getOrCreateClientId` (driver login) called `crypto.randomUUID()`. The
//      driver flow is mobile-only, so on the first real-device build it threw
//      before any request was made. The store's catch-all then reported it as
//      "Connection problem — check your signal", which pointed the diagnosis
//      at the network for an hour. Both halves are fixed.
//
//   2. `generateSixDigitCode` (admin code generation) called
//      `crypto.getRandomValues()`. This has never been hit because admins work
//      on the Electron build, but the iOS admin app runs identical code, so
//      generating codes on an iPhone would have failed. That one at least
//      failed loudly and safely — it refused rather than falling back to
//      `Math.random()`, which would have made the driver credential guessable.
//
// expo-crypto delegates to the platform CSPRNG — the browser's `crypto` on
// web, the native module on iOS and Android — so this is one code path on
// every platform rather than a runtime branch.
export function randomUUID(): string {
  return Crypto.randomUUID();
}

export function getRandomValues<T extends Uint32Array>(typedArray: T): T {
  return Crypto.getRandomValues(typedArray);
}
