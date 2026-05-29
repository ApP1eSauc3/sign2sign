# Sign2Sign — Services Layer

This file loads automatically for any file under `src/services/`. Services contain all async Supabase calls, storage operations, Google API calls, and auth. They may import from `src/data/`. They never import React or React Native.

> You are the service boundary of this app. Every function here is `async`. Screens and stores trust that you handle Supabase's quirks, RLS edge cases, and the storage key/URL distinction. Your job is to be a clean, predictable interface — not to bleed Supabase internals into the rest of the codebase.
>
> Two sources shape how this layer is written:
> - **Supabase JS docs**: Every `supabase.from().select()` call returns `{ data, error }`. Always destructure and check `error` before using `data`. Never assume `data` is non-null when `error` is null — check both.
> - **MDN — "Using Fetch"**: `fetch()` only rejects on network failure; a 4xx/5xx response resolves normally. Always check `response.ok` before parsing the body. For Google Sheets calls, treat non-2xx responses as errors.

---

## Import rules

```typescript
// ✅
import { supabase } from './supabaseClient';
import { SignJob, DriverSession } from '../data/SignJob';

// ❌
import { useDriverSession } from '../stores/useDriverSession';  // no stores
import { View } from 'react-native';  // no React/RN
import { useState } from 'react';     // no React
```

---

## The three auth entry points — always go through these

| Concern | File | Never call directly from |
|---|---|---|
| Admin auth | `AuthService.ts` | Screens, stores |
| Driver session | `RouteCodeService.ts` | Screens |
| Photo + GPS upload | `JobPhotoService.ts` | Screens |

---

## Async/await patterns — never `.then()` chains

Every function is `async`. Use `await` and `try/catch`. No callback chains, no nested `.then()`.

```typescript
// ✅ — linear, readable
async function loadJobs(routeCodeId: string): Promise<SignJob[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('route_code_id', routeCodeId)
    .order('sort_order');
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ✅ — bridge a callback-based Expo API to async
async function requestCameraPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    Camera.requestCameraPermissionsAsync().then((result) => {
      resolve(result.status === 'granted');
    });
  });
}

// ❌ — .then() chains make error paths hard to follow
supabase.from('jobs').select('*')
  .then(({ data }) => doSomething(data))
  .then(...)
  .catch(...);
```

---

## Supabase — always check both `data` and `error`

```typescript
// ✅ — check error before trusting data
const { data, error } = await supabase.from('route_codes').select('*, jobs(*)').single();
if (error) throw new Error(error.message);
return data;  // safe to use

// ❌ — data can be null even when error is null (e.g. no rows found)
const { data } = await supabase.from('route_codes').select('*').single();
return data.jobs;  // throws if data is null
```

---

## Supabase — storage keys, never signed URLs

**Never store a signed URL. Store the storage key. Sign at display time only.**

```typescript
// ✅ — save the key to the database
const { data, error } = await supabase.storage
  .from('job-photos')
  .upload(path, file);
const key = data?.path;  // store this string

// ✅ — sign at display time only (1-hour TTL)
const { data } = await supabase.storage
  .from('job-photos')
  .createSignedUrl(photoKey, 3600);
const url = data?.signedUrl;  // use in <Image>, never persist

// ❌ — never store this in the DB or in Zustand state
const signedUrl = data?.signedUrl;
await supabase.from('jobs').update({ photo_url: signedUrl });
```

---

## GPS — passed as parameter, never read inside a service

GPS is captured at the moment the upload starts. The store reads location and passes it in.

```typescript
// ✅ — location is a parameter; the service is pure
async function uploadJobPhoto(
  jobId: string,
  photo: Blob,
  currentLocation: { latitude: number; longitude: number }
): Promise<string>

// ❌ — service must never read GPS itself
import * as Location from 'expo-location';
const loc = await Location.getCurrentPositionAsync();  // wrong layer
```

---

## Driver auth — never call `supabase.auth`

Drivers have no Supabase Auth accounts. The 6-digit code IS the credential. Anon has **no** direct SELECT on `route_codes.code` or on `jobs` — all driver reads route through the `validate-code` Edge Function and the SECURITY DEFINER RPCs (`validate_route_code`, `recover_existing_photo`, `complete_job`). See `RouteCodeService.loadSession` for the canonical entry point.

```typescript
// ✅ — call the Edge Function, which IP-throttles and invokes validate_route_code()
const response = await fetch(`${supabaseUrl}/functions/v1/validate-code`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, client_id: clientUuid }),
});
if (!response.ok) throw new Error(`validate-code: ${response.status}`);
const session = await response.json();

// ❌ — direct anon SELECT on route_codes was the old path; revoked in migration 008
const { data } = await supabase.from('route_codes').select('*, jobs(*)').eq('code', code);

// ❌ — drivers never use Supabase Auth
await supabase.auth.signInWithPassword({ email, password });
```

---

## Admin auth — `supabase.auth` only in `AuthService.ts`

```typescript
// ✅ — in AuthService.ts only
const { error } = await supabase.auth.signInWithPassword({ email, password });

// ❌ — auth calls belong in AuthService, not scattered across services
```

---

## RLS — what the anon key can and cannot do

| Operation | Anon key | Admin session |
|---|---|---|
| Read active `route_codes` | ✅ (RLS policy) | ✅ |
| Read `jobs` for active codes | ✅ (RLS policy) | ✅ |
| Read active `route_codes` (id, driver_slot, created_date, expires_at, is_active only — `code` is column-revoked) | ✅ (granted in 006) | ✅ |
| Read `jobs` | ❌ (revoked in 006) — drivers reach jobs only through `validate_route_code()` / `recover_existing_photo()` RPCs | ✅ |
| Write `jobs` — photo fields directly (`JobPhotoService.uploadPhoto`) | ✅ via the legacy driver UPDATE policy (originally in migration 002; the file isn't in the repo but the policy still exists in prod — its USING clause checks `route_codes`, not `jobs`, which is why anon UPDATE survives the 006 SELECT revoke) | ✅ |
| Write `jobs.is_complete` (driver, `JobPhotoService.markJobComplete`) | ✅ via the `complete_job()` RPC (SECURITY DEFINER, FOR UPDATE row lock, idempotent) | ✅ |
| Write `jobs` — insert new jobs | ❌ | ✅ |
| Write `route_codes` | ❌ | ✅ |

The service role key is **never shipped in the app**. Edge Function (`supabase/functions/validate-code`) is the only component that holds it.

---

## Never read schema field names from memory — read the migration

Always read the migrations in `supabase/migrations/` before writing a Supabase query predicate (`001_initial.sql` baseline + `006_–010_` applied on top). Never guess column names. The TypeScript field mapping is in `src/data/CLAUDE.md`.

```typescript
// ✅ — verified against migration
.eq('route_code_id', id)
.eq('is_active', true)

// ❌ — guessed; may not exist
.eq('routeCodeId', id)
.eq('active', true)
```

---

## Error handling pattern — typed return, no naked throws

Return a typed error object from public service functions so callers don't need try/catch:

```typescript
// ✅ — caller knows exactly what can go wrong
export type ServiceError = { message: string };

async function signIn(
  email: string,
  password: string
): Promise<ServiceError | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { message: error.message };
  return null;
}

// ❌ — naked throw forces every caller to wrap in try/catch
async function signIn(email: string, password: string): Promise<void> {
  // throws on error — inconsistent with the rest of the layer
}
```

Internal helpers (not called by stores) may throw — the public API should return typed errors.

---

## `fetch()` for Google Sheets — always check `response.ok`

```typescript
// ✅ — fetch only rejects on network failure; check ok for HTTP errors
const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!response.ok) throw new Error(`Sheets API error: ${response.status}`);
const json = await response.json();

// ❌ — a 401 or 403 resolves normally; json() on an error body may throw unexpectedly
const json = await fetch(url).then((r) => r.json());
```

---

## What to avoid

- Reading GPS inside a service — pass `currentLocation` as a parameter
- Storing signed URLs in the database or returning them from services
- Calling `supabase.auth` for driver flows
- Importing from `stores/` — services do not know about state
- `.then()` chains — use `async/await` throughout
- Guessing column names — always read the migration first
- Direct Supabase calls from screens — always go through a service
