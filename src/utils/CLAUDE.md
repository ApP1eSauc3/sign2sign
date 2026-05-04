# Sign2Sign — Utils Layer

This file loads automatically for any file under `src/utils/`. Utils contains formatters, shared hooks, camera helpers, and the design system tokens. No imports from `src/data/`, `src/services/`, or `src/stores/`. May import React/RN for hooks and components.

> You are building the toolkit that every screen reaches for. Consistency lives here — one colour token file, one date formatter, one camera helper. If a pattern appears in two screens, it belongs here; if in one screen only, it does not. The test for a util: could any screen in this app use it without knowing where it came from? If yes, it's a util. If it needs to know about jobs or sessions, it belongs in a store or service.

---

## Import rules

```typescript
// ✅
import { StyleSheet } from 'react-native';
import { useState, useEffect } from 'react';

// ❌ — utils has no knowledge of domain types or business logic
import { SignJob } from '../data/SignJob';
import { AuthService } from '../services/AuthService';
import { useDriverSession } from '../stores/useDriverSession';
```

---

## Available utilities — check here before creating a new one

| Utility | File | Purpose |
|---|---|---|
| Colour tokens | `colors.ts` | All colour values — import this, never raw hex |

*Add new utilities to this table when you create them. If a util already exists for your use case, extend it rather than creating a parallel one.*

---

## `colors.ts` — the single source of truth for all colour values

**Never use a raw hex string in a StyleSheet. Always import from `colors.ts`.**

```typescript
// ✅
import { colors } from '../utils/colors';
backgroundColor: colors.brand

// ❌ — raw hex in a component
backgroundColor: '#147EC4'
```

Never introduce a new colour without adding it to `colors.ts` first. See `src/screens/CLAUDE.md §1.1` for the full token table and `CLAUDE.md` (root) for the HSL variation rules.

---

## Brand blue rule *(from sign2site.com.au)*

`colors.brand` is used as a **solid fill only**. White text always sits on top. It is never used as a tint, as text colour on a light background, or at reduced opacity.

```typescript
// ✅ — solid fill, white text on top
backgroundColor: colors.brand,
color: colors.white,

// ❌ — brand as a tint
backgroundColor: `${colors.brand}33`,

// ❌ — brand as text on white/light background
color: colors.brand,  // on adminSurface or white background
```

---

## Custom hooks — when to create one

Create a custom hook when:
- The same combination of `useState` + `useEffect` appears in two or more screens
- The hook encapsulates a side effect with a clear name (`useCurrentLocation`, `useCameraPermission`, `usePhotoCapture`)
- The hook needs to manage its own cleanup (returning a cleanup function from `useEffect`)

Keep it inline in the screen when:
- It's used in one screen only and is fewer than ~10 lines
- It's a simple `useState` with no side effects

```typescript
// ✅ — extracted hook: same location logic used across multiple screens
export function useCurrentLocation() {
  const [location, setLocation] = useState<Coords | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Location.getCurrentPositionAsync()
      .then((pos) => { if (!cancelled) setLocation(pos.coords); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };  // cleanup prevents state update on unmount
  }, []);

  return { location, error };
}

// ❌ — domain knowledge in a util (knows about SignJob)
export function useJobLocation(job: SignJob) { ... }
```

---

## Effect cleanup — always cancel async work on unmount

React effects that start async operations must cancel them on unmount to prevent state updates on unmounted components.

```typescript
// ✅ — cancellation flag prevents state update after unmount
useEffect(() => {
  let cancelled = false;
  someAsyncOperation().then((result) => {
    if (!cancelled) setState(result);
  });
  return () => { cancelled = true; };
}, []);

// ✅ — AbortController for fetch-based effects
useEffect(() => {
  const controller = new AbortController();
  fetch(url, { signal: controller.signal })
    .then((r) => r.json())
    .then(setState)
    .catch(() => {});  // AbortError is expected — ignore it
  return () => controller.abort();
}, [url]);
```

---

## StyleSheet extraction — when to extract a style

Extract to a shared StyleSheet when:
- The same combination of 3+ style properties appears in two or more files
- The style has a semantic name ("jobCard", "sectionHeader", "statusBadge")

Keep it inline when:
- It's a one-off on a single component
- It's fewer than 3 properties

```typescript
// ✅ — named, reusable, semantically clear
const sharedStyles = StyleSheet.create({
  jobCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});

// ✅ — one-off inline, not worth extracting
style={{ marginTop: 8 }}
```

---

## Spacing grid — only these values

See `src/screens/CLAUDE.md §1.3` for the full rationale. The grid: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Never use values like 14, 18, 22, 26, 34.

---

## What to avoid

- Importing from `data/`, `services/`, or `stores/` — utils is infrastructure
- Raw hex strings in any file in this layer
- Business logic — utils formats and transforms; it does not decide
- Creating a hook or utility that duplicates one already in this layer
- Missing cleanup in `useEffect` async operations — always cancel on unmount
