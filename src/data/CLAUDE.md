# Sign2Sign — Data Layer

This file loads automatically for any file under `src/data/`. Data contains types, interfaces, enums, and error classes. No async. No React/RN imports. No imports from this project.

> You are defining the vocabulary of the entire codebase. Every other layer speaks in the types you define here. Get these wrong and TypeScript errors cascade upward through services, stores, and screens. Your job is precision: correct semantics, explicit discriminated unions, no guessing at field names.
>
> Two sources shape how this layer is written:
> - **TypeScript handbook — "Narrowing"**: Discriminated unions with a `status` or `kind` literal field are the correct pattern for closed state machines. The compiler's exhaustiveness check (`never` in a switch default) is your safety net. Use it.
> - **TypeScript handbook — "Everyday Types"**: Default to `readonly` properties. Use `let`/mutable only when mutation is explicitly required. Most domain models — jobs, sessions, upload states — are snapshots that benefit from immutability.

---

## Import rules

```typescript
// ✅
// No imports — data types are self-contained

// ❌
import { supabase } from '../services/supabaseClient';  // no persistence
import { useDriverSession } from '../stores/useDriverSession';  // no stores
import { View } from 'react-native';  // no React/RN
```

---

## `interface` vs `type` vs `enum`

- **`interface`** — for object shapes that may be extended (e.g. `SignJob`, `DriverSession`)
- **`type`** — for unions, aliases, and mapped types (e.g. `JobUploadState`, `JobType`)
- **`enum`** — for closed named sets with string values (e.g. `AppMode`). Use **string enums** so values are readable in logs, Supabase queries, and the DB.
- **Never** `any` — if the shape is unknown, use `unknown` and narrow it

```typescript
// ✅ — discriminated union with a literal status field
export type JobUploadState =
  | { status: 'idle' }
  | { status: 'capturing' }
  | { status: 'preview'; imageUri: string }  // photo taken, awaiting driver confirmation
  | { status: 'uploading' }
  | { status: 'succeeded'; photoKey: string }
  | { status: 'failed'; message: string };

// ✅ — string enum, readable in DB and logs
export enum AppMode {
  Undecided = 'undecided',
  AdminAuthenticated = 'admin',
  DriverActive = 'driver',
}

// ❌ — numeric enum is opaque in logs and Supabase
export enum AppMode { Undecided, Admin, Driver }

// ❌ — any collapses all type safety
function process(job: any) { ... }
```

---

## `readonly` as default

Default to `readonly` on interface properties. Use mutable `var` only when mutation is an explicit requirement of the model.

```typescript
// ✅ — snapshot: immutable by default
export interface SignJob {
  readonly id: string;
  readonly clientName: string;
  readonly agentEmail: string;
  isComplete: boolean;  // writable — store updates this
  photoKey?: string;    // writable — set after upload
}

// ❌ — all fields mutable by default; nothing communicates intent
export interface SignJob {
  id: string;
  clientName: string;
  agentEmail: string;
  isComplete: boolean;
  photoKey?: string;
}
```

---

## Exhaustive switching on discriminated unions

```typescript
// ✅ — compiler catches missing states at build time
function labelForState(state: JobUploadState): string {
  switch (state.status) {
    case 'idle':       return 'Take Photo';
    case 'capturing':  return 'Opening Camera…';
    case 'preview':    return 'Use Photo';
    case 'uploading':  return 'Uploading…';
    case 'succeeded':  return 'Mark Complete';
    case 'failed':     return 'Retry Photo';
    default: {
      const _exhaustive: never = state;  // compile error if a case is missing
      return '';
    }
  }
}

// ❌ — string comparison bypasses narrowing
if (state.status === 'done') { ... }  // 'done' does not exist — silent bug
```

---

## Every type must be defined here before being referenced elsewhere

If `services/`, `stores/`, or `screens/` reference a type that doesn't exist here, TypeScript throws "Cannot find name X". Define the type first, then write code that uses it.

One definition per type — no duplicate interfaces across files.

---

## `JobUploadState` — six states, no others

```typescript
// ✅
{ status: 'idle' }
{ status: 'capturing' }
{ status: 'preview'; imageUri: string }  // photo taken, awaiting driver confirmation
{ status: 'uploading' }
{ status: 'succeeded'; photoKey: string }
{ status: 'failed'; message: string }

// ❌ — these states do not exist
{ status: 'pending' }
{ status: 'done' }
{ status: 'complete' }
```

---

## `SignJob.photoKey` is a storage key, never a URL

```typescript
// ✅
photoKey?: string  // e.g. "jobs/abc123/photo.jpg" — the Supabase storage key

// ❌ — never store a signed URL in the type or the database
photoUrl?: string
```

---

## `SignJob` field names — match the Supabase schema exactly (snake_case → camelCase)

Always verify against `supabase/migrations/` — `001_initial.sql` is the committed baseline and `006_–010_` are the applied migrations on top. When in doubt, check the baseline or a migration that references the columns (e.g. 006 for `route_codes` / `jobs` predicates) or read the typed shape in `RouteCodeService.ts`. Never guess.

| DB column | TypeScript field |
|---|---|
| `client_name` | `clientName` |
| `agent_email` | `agentEmail` |
| `sign_description` | `signDescription` |
| `job_type` | `jobType` |
| `sort_order` | `sortOrder` |
| `is_complete` | `isComplete` |
| `photo_key` | `photoKey` |
| `photo_gps_lat` | `photoGPSLat` |
| `photo_gps_lng` | `photoGPSLng` |
| `photo_timestamp` | `photoTimestamp` |
| `route_code_id` | (on `DriverSession`, not `SignJob`) |

---

## What to avoid

- `async` functions — Data has no knowledge of persistence or networking
- `import` from any other layer
- `any` type — use `unknown` and narrow
- All-mutable interfaces as the default — prefer `readonly` where mutation isn't required
- Defining a type that duplicates a Supabase-generated type from the schema
- Status strings that aren't in the discriminated union (adds silent bugs)
