# Sign2Sign — Stores Layer

This file loads automatically for any file under `src/stores/`. Stores are Zustand state machines. They orchestrate services and publish state to screens. They never import React or React Native.

> You are writing the state machines of this app. A store is a projection of domain data into displayable state — nothing more. It does not know what a `View` or `TouchableOpacity` is. It does not make layout decisions. It answers one question: "given what I know about the world, what should the UI show right now?" Business logic lives here. Screens read booleans and call actions.
>
> Two sources shape how this layer is written:
> - **Zustand docs — "Flux-inspired practice"**: State is a snapshot; actions are the only way to update it. Keep state minimal — derive as much as possible from the stored values rather than duplicating computed properties. Selectors are the bridge between store shape and what the screen needs.
> - **React docs — "Thinking in React"**: The store owns domain state (`jobs`, `uploadStates`, `session`). The screen owns presentation state (`showModal`, `isExpanded`). Never blend the two. If a store property is named `buttonColor` or `isSheetOpen`, it has crossed the boundary.

---

## Import rules

```typescript
// ✅
import { create } from 'zustand';
import { SignJob, JobUploadState, DriverSession } from '../data/SignJob';
import { RouteCodeService } from '../services/RouteCodeService';

// ❌
import { View, TouchableOpacity } from 'react-native';  // no RN
import { useState } from 'react';  // no React hooks
import { supabase } from '../services/supabaseClient';  // go through a service
```

---

## Zustand canonical pattern

```typescript
import { create } from 'zustand';
import { JobUploadState, DriverSession } from '../data/SignJob';
import { RouteCodeService } from '../services/RouteCodeService';

interface DriverSessionStore {
  session: DriverSession | null;
  uploadStates: Record<string, JobUploadState>;
  isLoading: boolean;
  error: string | null;
  loadSession: (code: string) => Promise<void>;
  canMarkComplete: (jobId: string) => boolean;
  markComplete: (jobId: string) => Promise<void>;
}

export const useDriverSession = create<DriverSessionStore>((set, get) => ({
  session: null,
  uploadStates: {},
  isLoading: false,
  error: null,

  loadSession: async (code) => {
    if (get().isLoading) return;  // guard against double-fire
    set({ isLoading: true, error: null });
    try {
      const session = await RouteCodeService.loadSession(code);
      set({ session, isLoading: false });
    } catch (e) {
      set({ error: (e as Error).message, isLoading: false });
    }
  },

  canMarkComplete: (jobId) => {
    return get().uploadStates[jobId]?.status === 'succeeded';
  },

  markComplete: async (jobId) => {
    // ...
  },
}));
```

---

## Store vs Screen responsibility

| Belongs in the Store | Belongs in the Screen |
|---|---|
| Data fetching (async actions) | Layout and styling |
| Business logic | User interaction handlers (calling store actions) |
| Domain state (`jobs`, `uploadStates`, `session`) | Presentation state (`showModal`, `isExpanded`) |
| Error handling | Animation triggers |
| Service calls | `useEffect`, `useCallback`, `useMemo` |
| `canMarkComplete` | Reading `canMarkComplete` and setting `disabled` |

The screen describes UI given current state. The store never describes UI. If a store property is named `buttonLabel` or `cardBorderColor`, it has crossed the boundary.

---

## Async guard against double-fire

Prevent concurrent invocations of the same async action:

```typescript
// ✅ — isLoading guard prevents duplicate network calls
loadSession: async (code) => {
  if (get().isLoading) return;
  set({ isLoading: true, error: null });
  try {
    const session = await RouteCodeService.loadSession(code);
    set({ session, isLoading: false });
  } catch (e) {
    set({ error: (e as Error).message, isLoading: false });
  }
},

// ❌ — no guard; rapid calls fire duplicate requests
loadSession: async (code) => {
  set({ isLoading: true });
  const session = await RouteCodeService.loadSession(code);
  set({ session, isLoading: false });
},
```

Always reset `isLoading` in both the success and error paths — never leave it stranded at `true`.

---

## `canMarkComplete` must live in the store, never in a screen

```typescript
// ✅ — in the store
canMarkComplete: (jobId) => {
  return get().uploadStates[jobId]?.status === 'succeeded';
},

// ✅ — screen reads the bool, no logic
const enabled = useDriverSession((s) => s.canMarkComplete(jobId));
<TouchableOpacity disabled={!enabled} />

// ❌ — logic leaking into the screen
const uploadState = useDriverSession((s) => s.uploadStates[jobId]);
const enabled = uploadState?.status === 'succeeded';
```

---

## Upload state machine — six states, always in `uploadStates` record

```typescript
// ✅ — keyed by jobId
uploadStates: Record<string, JobUploadState>

// State transitions (always in this order):
// idle → capturing → preview → uploading → succeeded | failed
// failed → capturing (retry)
// preview → idle (retake)

// ✅ — spread to update one job without affecting others
set((s) => ({
  uploadStates: { ...s.uploadStates, [jobId]: { status: 'uploading' } },
}));

// ❌ — overwrites every other job's upload state
set({ uploadStates: { [jobId]: { status: 'uploading' } } });
```

---

## Selector granularity — subscribe to the minimum slice

```typescript
// ✅ — only re-renders when this job's upload state changes
const uploadState = useDriverSession((s) => s.uploadStates[jobId]);

// ✅ — only re-renders when session changes
const session = useDriverSession((s) => s.session);

// ❌ — re-renders on any store change
const store = useDriverSession();
const uploadState = store.uploadStates[jobId];
```

---

## Never call Supabase directly — go through a service

```typescript
// ✅
const session = await RouteCodeService.loadSession(code);

// ❌
const { data } = await supabase.from('route_codes').select('*').eq('code', code);
```

---

## What to avoid

- `canMarkComplete` logic in a screen — always in the store
- Direct Supabase calls — go through `services/`
- Storing signed URLs in state — store keys only
- `import` from React or React Native
- Sharing state between admin and driver stores — they are separate domains
- Store properties named after UI concepts (`buttonLabel`, `cardColor`)
- Forgetting to reset `isLoading: false` in error paths
