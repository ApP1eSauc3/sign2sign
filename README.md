# Sign2Sign

Field operations app for sign installation and removal crews. Drivers use a codeless mobile app to work through daily job routes, capture GPS-tagged photos, and mark jobs complete. Admins manage routes, generate daily codes, and import jobs from Google Sheets — on iOS or desktop (Electron).

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Authentication Model](#authentication-model)
- [Core Flows](#core-flows)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Running the App](#running-the-app)
- [Building for Production](#building-for-production)
- [Error Catalogue](#error-catalogue)
- [Design System](#design-system)
- [Contributing](#contributing)

---

## Overview

Sign2Sign solves a coordination problem for sign installation companies: crews need job-by-job instructions in the field without requiring accounts, and admins need real-time visibility into job completion with photographic proof.

**Two user types, two separate worlds:**

| Role | Platform | Auth method |
|---|---|---|
| Driver | iOS (Expo Go / standalone) | 6-digit daily code — no account required |
| Admin | iOS + desktop (Electron — macOS shipped in v1.0.0; Windows deferred until a code-signing cert exists) | Email/password via Supabase Auth |

Key constraints driving every architectural decision:
- Drivers may have poor connectivity mid-route — offline queue handles this
- Screens are read in under 2 seconds in direct sunlight — WCAG AAA contrast is the minimum
- Gloved hands operate the UI — 56pt minimum touch targets throughout
- Photo proof is mandatory before any job can be marked complete — no exceptions

---

## Architecture

```
src/data/         Types, enums, interfaces. No imports from this project.
src/services/     Async layer: Supabase, Storage, Google Sheets, Auth. No React.
src/stores/       Zustand state machines. Orchestrate services. No React.
src/utils/        Pure helpers, colour tokens. No domain imports.
src/screens/      React Native UI. Only layer with JSX. Reads stores, calls actions.
src/navigation/   React Navigation stacks and param lists. No business logic.
```

**Strict one-way dependency rule:**

```
screens → stores → services → data
              ↘           ↗
               utils ────
```

No layer may import from a layer above it. Screens never call Supabase directly.

---

## Tech Stack

| Concern | Technology | Version |
|---|---|---|
| Mobile framework | Expo (React Native) | SDK 55 / RN 0.83 |
| Language | TypeScript | 5.9 |
| Desktop shell | Electron | 41 |
| Backend | Supabase (Postgres + Storage + Auth) | supabase-js 2 |
| State management | Zustand | 5 |
| Navigation | React Navigation (native stack) | 7 |
| Job import | Google Sheets API v4 | — |
| Photo handling | expo-image-picker + expo-image-manipulator | SDK 55 |
| Location | expo-location | SDK 55 |
| Offline storage | AsyncStorage | 2.2 |
| Network detection | expo-network | SDK 55 |
| Secrets (mobile) | expo-secure-store | SDK 55 |
| Google OAuth2 | expo-auth-session + expo-web-browser | SDK 55 |
| Haptics | expo-haptics | SDK 55 |

---

## Project Structure

```
sign2sign/
├── App.tsx                         Root component — mounts navigator
├── index.ts                        Expo entry point
├── app.json                        Expo config (Human-owned — do not edit)
├── electron/
│   └── main.js                     Thin Electron shell — no business logic
├── assets/                         App icons and splash (Human-owned)
├── supabase/
│   ├── functions/
│   │   ├── validate-code/index.ts           IP-throttled Edge Function wrapping validate_route_code()
│   │   └── delete-admin-account/index.ts    JWT-verified in-app account deletion (Apple 5.1.1(v))
│   └── migrations/
│       ├── 001_initial.sql                  Committed baseline (prod dump; captures dashboard-era 001–005)
│       ├── 006_rate_limit_codes.sql         Per-client rate limit, anon SELECT revoke on jobs, validate/recover RPCs
│       ├── 007_prune_code_attempts.sql      Periodic prune of code_attempts table (24h, pg_cron)
│       ├── 008_revoke_rpc_from_anon.sql     Forces drivers through the Edge Function only
│       ├── 009_storage_policies.sql         Locks down the job-photos bucket
│       ├── 010_revoke_validate_route_code_from_public.sql  Closes PUBLIC execute bypass left by 008
│       ├── 011_admin_delete_incomplete_jobs.sql  Admin DELETE on incomplete jobs (makes re-import real)
│       └── 012_offline_sync_grace.sql       24h finish-work grace for expired codes (offline queue)
└── src/
    ├── data/
    │   └── SignJob.ts              SignJob, DriverSession, AppMode, JobUploadState
    ├── services/
    │   ├── supabaseClient.ts       Supabase client singleton
    │   ├── AuthService.ts          Admin sign in/out/session + account deletion
    │   ├── RouteCodeService.ts     Driver session load + admin code generation
    │   ├── JobPhotoService.ts      Camera capture, Storage upload, mark complete
    │   ├── GoogleSheetsService.ts  Job import from Google Sheets
    │   ├── GoogleAuthService.ts    OAuth2 token management for Sheets
    │   ├── RouteService.ts         Driving-route optimisation (Routes API via the optimize-route Edge Function; straight-line fallback)
    │   └── OfflineQueueService.ts  AsyncStorage queue for offline operations
    ├── stores/
    │   ├── useAppStore.ts          AppMode — root navigation signal
    │   └── useDriverSession.ts     Driver session, upload state machine, offline sync
    ├── utils/
    │   ├── colors.ts               Brand colour tokens (single source of truth)
    │   ├── secureStorage.ts        SecureStore / keychain adapter
    │   └── useNetworkStatus.ts     Network state hook
    ├── navigation/
    │   ├── AppNavigator.tsx        Root — branches on AppMode
    │   ├── AdminStack.tsx          Admin screen stack
    │   └── DriverStack.tsx         Driver screen stack
    └── screens/
        ├── ModeSelectScreen.tsx    Landing — choose Admin or Driver
        ├── OfflineBanner.tsx       Persistent offline indicator
        ├── admin/
        │   ├── AdminLoginScreen.tsx
        │   ├── AdminDashboardScreen.tsx
        │   ├── AdminRouteDetailScreen.tsx
        │   ├── AccountScreen.tsx        Privacy link + in-app account deletion
        │   └── GoogleConnectScreen.tsx
        └── driver/
            ├── DriverCodeScreen.tsx
            ├── DriverRouteScreen.tsx
            ├── DriverMapScreen.tsx      Native map route view (web stub keeps react-native-maps out of Electron)
            └── DriverJobScreen.tsx
```

---

## Database Schema

### `route_codes`

Daily codes — one per driver slot. Expire at 06:00 the following morning so drivers finishing late jobs are not locked out mid-shift.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `code` | text UNIQUE | 6-digit string |
| `driver_slot` | int | "Driver 1", "Driver 2", etc. |
| `created_date` | date | Date the code was generated |
| `expires_at` | timestamptz | 06:00 the following morning |
| `is_active` | boolean | `false` when replaced or manually revoked |

### `jobs`

Individual sign installation or removal tasks. Imported from Google Sheets and linked to a route code.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `route_code_id` | uuid FK | References `route_codes(id)` ON DELETE CASCADE |
| `client_name` | text | Property owner |
| `agent_name` | text | Real estate agent name |
| `agent_email` | text | Pre-loaded from Sheets — no manual lookup |
| `address` | text | Job site address |
| `sign_description` | text | Sign type/size |
| `job_type` | text | `'install'` or `'removal'` |
| `latitude` | float | Job site coordinates |
| `longitude` | float | Job site coordinates |
| `sort_order` | int | Display order within route |
| `is_complete` | boolean | Set after mark-complete |
| `photo_key` | text | Supabase Storage key — never a signed URL |
| `photo_gps_lat` | float | GPS at upload time |
| `photo_gps_lng` | float | GPS at upload time |
| `photo_timestamp` | timestamptz | Timestamp at upload time |

### RLS and grants — what the anon key can actually do

Policies alone don't tell the story: migrations 006/008/010 revoked grants on
top of them, so several baseline policies are unreachable for anon. Current
model:

| Access | Anon (drivers) | Authenticated (admins) |
|---|---|---|
| Read `route_codes` | Only `id, driver_slot, created_date, expires_at, is_active` (the `code` column is grant-revoked, 006) | ✅ all, incl. historical |
| Read `jobs` | ❌ table SELECT revoked (006) — job data reaches drivers only through `validate_route_code()` via the `validate-code` Edge Function | ✅ all — survives code expiry (route detail works next morning) |
| Write `jobs` photo fields | ✅ driver UPDATE policy, gated on the job's code being live (24h sync grace — migration 012, live-verified 2026-06-10) | ✅ |
| Set `jobs.is_complete` | ✅ only via `complete_job()` RPC (SECURITY DEFINER, row lock, photo gate, idempotent) | — admins never write `is_complete` |
| INSERT `jobs` | ❌ | ✅ |
| DELETE `jobs` | ❌ | ✅ incomplete jobs only (migration 011 — completion evidence is not deletable from the app) |
| Write `route_codes` | ❌ | ✅ INSERT/UPDATE |
| Execute `validate_route_code()` | ❌ revoked from anon (008) and PUBLIC (010) — Edge Function only | — |

The service role key is never shipped in the app; only the Edge Functions hold it.

---

## Authentication Model

### Admin

1. Admin opens app → selects Admin mode → enters email and password
2. `AuthService.signIn()` calls `supabase.auth.signInWithPassword()`
3. On success, `useAppStore` sets `AppMode.AdminAuthenticated`
4. Root navigator renders the Admin stack

### Driver (codeless)

Drivers have no Supabase Auth accounts. The 6-digit code is the credential.

1. Driver opens app → selects Driver mode → enters 6-digit code
2. `RouteCodeService.loadSession(code)` POSTs `{ code, client_id }` to the `validate-code` Edge Function (the device's anonymous `client_id` UUID feeds the per-device rate limit)
3. The function IP-throttles, then invokes the `validate_route_code()` RPC with the service-role key — direct anon access to that RPC was revoked in migrations 008/010, and anon cannot read `route_codes.code` or `jobs` at all
4. A valid, unexpired code returns the full session payload (slot + job list) and the Driver stack renders; an invalid/expired code returns `{ session: null }`
5. `supabase.auth` is never called for drivers

### Daily code generation

1. Admin taps "Generate Codes" on the dashboard (a confirm warns that codes drivers are currently using stop working immediately)
2. `RouteCodeService.generateDailyCodes([1, 2, 3, ...])` runs per slot:
   - Deactivates any **live** code for that slot (filtered by expiry, not by date — `created_date` is a local business-day label; already-expired codes are left alone so the offline-sync grace window keeps working)
   - Inserts a new 6-digit code (crypto RNG) with expiry at 06:00 tomorrow
   - Retries up to 5 times on a 6-digit collision (Postgres constraint `23505`)
3. Admin shares codes with drivers verbally or via the dashboard display

---

## Core Flows

### Job Import

1. Admin connects Google account via `GoogleConnectScreen`
2. Pastes a Google Sheets URL containing job data
3. `GoogleSheetsService.importJobs(sheetId)` fetches rows via Sheets API v4
4. `saveJobsToRoute()` uses **replace-incomplete** semantics: the route's incomplete jobs are deleted (migration 011 scopes the DELETE policy to `is_complete = false`), rows matching an already-completed job are skipped, the rest are inserted — re-importing a corrected sheet never touches completion evidence
5. `agent_email` is captured at import time — no manual lookup later

### Photo Capture and Upload

The upload state machine enforces the photo gate:

```
idle → capturing → preview → uploading → succeeded
                     ↓                        ↑
                    idle (retake)      failed → capturing (retry)
```

1. Driver taps "Take Photo" → `capturePhoto()` opens camera
2. Photo displayed for review — driver confirms or retakes
3. On confirm, the screen requests location permission, reads current GPS coordinates, and passes them to `confirmAndUpload(jobId, location)` — services never read GPS directly
4. `JobPhotoService.uploadPhoto()` resizes the image (max 1600px), uploads to `job-photos` bucket, writes storage key + GPS to the job record
5. `canMarkComplete(jobId)` returns `true` only when state is `succeeded`
6. Driver taps "Mark Complete" — `JobPhotoService.markJobComplete()` sets `is_complete = true`

**GPS is captured at upload time, not assignment time.** The store reads location and passes it as a parameter — services never read GPS directly.

**Storage keys, never signed URLs.** The `photo_key` column stores the Supabase Storage path string (e.g. `jobs/abc123/1234567890.jpg`). Signed URLs are generated at display time with a 1-hour TTL and never persisted.

### Offline Queue

If the device has no connectivity when a driver confirms a photo:

1. `OfflineQueueService.enqueue()` persists the upload operation to AsyncStorage
2. Upload state is set to `failed` with message: `"No connection — photo queued and will upload automatically when online."`
3. `flushOfflineQueue()` replays queued operations on three triggers: connectivity returning mid-session (`OfflineBanner`), a successful session load, and **mounting the driver code screen** — the last one matters because queued ops carry their own route code and must be able to sync even when the code has expired and no session can be opened
4. Server-side, finish-work writes (`complete_job`, photo-field UPDATE, photo recovery) accept codes up to 24 hours past expiry (migration 012) — a driver who went home offline only has to open the app the next morning for yesterday's evidence to land. Expired codes still cannot open sessions or read job data
5. Retaking a photo calls `OfflineQueueService.remove(jobId, 'upload')` first — prevents the old queued photo uploading after the driver retakes

If the device has no connectivity when a driver taps "Mark Complete":

1. The operation is enqueued and the job is **optimistically marked complete locally** — the driver sees the job as done immediately
2. No error is shown — from the driver's perspective, the tap succeeded
3. On next session load, the queued mark-complete is flushed to Supabase

---

## Getting Started

### Prerequisites

- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- Supabase CLI (for migrations): `brew install supabase/tap/supabase`
- Xcode (for iOS simulator)
- A Supabase project with the schema applied

### Install dependencies

```bash
npm install
```

### Apply database migrations

```bash
supabase db push
```

---

## Environment Variables

Create `.env.local` in the project root. This file is gitignored — never commit it.

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Optional — Google Sheets import (see docs/GOOGLE_OAUTH_SETUP.md)
EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS=...
EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB=...

```

**There is deliberately no Google Maps key here.** Geocoding (Sheets import)
and route optimisation (driver map) both run through Edge Functions that hold
the key as a Supabase secret — `supabase secrets set GOOGLE_MAPS_API_KEY=…`.
Google Maps web service APIs cannot be restricted to an app bundle ID, only to
IP addresses, so a key in this file would ship in the bundle unrestricted. See
`supabase/functions/geocode-address/index.ts` for the full reasoning, and the
handover's Maps key runbook for setup.

The service role key is never used in the app. Admin write access is controlled via Supabase Auth sessions and RLS policies.

---

## Running the App

### iOS (simulator or device)

```bash
npm run ios
# or
npx expo start
```

### Android

```bash
npm run android
```

### Web (for Electron development)

```bash
npm run web:dev
```

### Electron (desktop admin)

Launch against the last web build (run `npm run web` first if `dist/` is stale):

```bash
npm run electron:dev
```

For a packaged, signed, notarized macOS build:

```bash
npm run electron:build:mac
```

---

## Building for Production

### iOS (EAS Build)

```bash
eas build --platform ios
```

### Desktop (Electron)

```bash
npm run electron:build:mac   # macOS — exports web, packages, signs, notarizes, staples
npm run electron:build:win   # Windows — configured but DEFERRED: no code-signing cert yet
```

Admin on iOS and admin on desktop run identical React code — only the shell differs.

---

## Error Catalogue

All user-facing error strings are listed here. Find their source in the referenced file.

### Driver Auth

| Error message | Cause | Source |
|---|---|---|
| `Invalid or expired code. Try again.` | Edge Function returned `{ session: null }` — code not found, expired, or `is_active = false` | `useDriverSession.ts` — `loadSession` |
| `Too many attempts. Wait a minute and try again.` | HTTP 429 from either the Edge Function's per-IP throttle or the RPC's per-device limit (5 failed attempts / 60s) | `RouteCodeService.ts` — `loadSession`, surfaced verbatim by the store |
| `Connection problem — check your signal and try again.` | Network or server error during code lookup (not an invalid code) | `useDriverSession.ts` — `loadSession` |

### Photo Capture

| Error message | Cause | Source |
|---|---|---|
| `Camera access is required to take job photos. Enable it in Settings.` | User denied camera permission | `JobPhotoService.ts` — `capturePhoto` |
| `Could not open camera.` | Camera hardware error or unexpected ImagePicker failure | `useDriverSession.ts` — `capturePhoto` |

### Location

| Error message | Cause | Source |
|---|---|---|
| `Location access is required to record where this job was completed. Enable it in Settings, then tap Retry Photo.` | User denied location permission when driver tapped Confirm | `useDriverSession.ts` — `handleLocationDenied` |

### Photo Upload

| Error message | Cause | Source |
|---|---|---|
| `No connection — photo queued and will upload automatically when online.` | Device offline when driver confirmed photo; operation enqueued | `useDriverSession.ts` — `confirmAndUpload` |
| `Upload failed. Try again.` | Supabase Storage upload error or job record update error | `useDriverSession.ts` — `confirmAndUpload` |

### Mark Complete

| Error message | Cause | Source |
|---|---|---|
| `Could not mark complete. Try again.` | Supabase job update failed; Supabase error message also surfaced when available | `useDriverSession.ts` — `markComplete` |

### Admin — Code Generation

| Error message | Cause | Source |
|---|---|---|
| `Could not deactivate existing code for Driver {N}: {supabase error}` | Supabase error when deactivating previous code for a slot | `RouteCodeService.ts` — `generateDailyCodes` |
| `Could not generate a unique code for Driver {N} — please try again` | 5 consecutive 6-digit collisions on the unique constraint (extremely unlikely) | `RouteCodeService.ts` — `generateDailyCodes` |

### Supabase Internal Codes (not shown to users)

| Code | Meaning | Handling |
|---|---|---|
| `23505` | Unique constraint violation on `code` column during insert | `RouteCodeService.generateDailyCodes` retries with a new 6-digit value (up to 5 attempts) |
| `P0002` | `photo_key` write-once trigger — an earlier upload reached the DB but the response was lost | Since migration `013` the client never sees this. `record_job_photo()` checks for an existing `photo_key` **before** updating and returns the stored row with `already_recorded: true`, so the trigger is unreachable defence-in-depth rather than a control-flow path. The old two-round-trip recovery via `recover_existing_photo()` is gone. |
| `P0004` | Duplicate-location trigger — address + job type already assigned to another driver today | `GoogleSheetsService.saveJobsToRoute` maps to a plain-English import error |
| `P0005` | Per-device rate limit inside `validate_route_code()` | Reaches the client as HTTP 429 → "Too many attempts" message |

---

## Design System

Colour tokens and usage rules live in `src/utils/colors.ts`. Key principles:

- **Brand**: Two colours only — white and one sky blue. See `colors.brand` in `src/utils/colors.ts` (sampled from the Sign2Site logo 2026-05-31). No gradients, no third colour.
- **Contrast**: WCAG AAA (7:1) minimum. `colors.bg` + `colors.textPrimary` achieves 16:1. Direct sunlight reduces effective contrast by ~50%.
- **Touch targets**: 56pt minimum (bare fingers), 64pt for primary actions (gloved hands).
- **Admin mode**: Light background, blue accents.
- **Driver mode**: Dark background — reduces glare in outdoor conditions.
- **Advancing action button**: One primary CTA per job screen. Its label and colour change as job state advances. The driver never decides what to do next.
- **Raw hex values are banned in StyleSheets** — always use tokens from `src/utils/colors.ts`.

---

## Contributing

### Layer rules

The codebase follows a strict layered architecture (`data → services → stores → utils → screens → navigation`). Each layer has its own import rules: services may import data but no React/RN; stores may import services and data; only screens contain UI. Keep these boundaries when adding code.

### Doc rules

Facts live in one canonical place — link, don't restate: RLS in this README's grants table, colours in `src/utils/colors.ts`, npm scripts in `package.json`. Deployed-state claims should carry a date and how they were verified. Never document a retention/deletion behaviour that nothing in the code implements.

### Adding a database column

1. Create a new migration file with the next sequence number (next free: `013_*.sql`; `006_`–`012_` are applied to prod, live-verified 2026-06-10) — never edit pushed migrations
2. Update the relevant type in `src/data/`
3. Update any service that reads or writes that table
4. Run `supabase db push`

### Non-negotiable constraints

- Photo is mandatory before "Mark Complete" — for installs and removals
- `canMarkComplete(jobId)` lives in the store, never in a screen
- Storage keys only — never store or pass signed URLs
- GPS is passed as a parameter to upload functions — never read inside a service
- `supabase.auth` is never called for driver flows
- `agent_email` must come from the Sheets import — never hardcoded
