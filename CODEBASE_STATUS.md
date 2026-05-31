# Sign2Sign — Codebase Status

## Skills

| Name | Trigger | Covers |
|------|---------|--------|
| `postgres-best-practices` | Any Supabase query, migration, schema, or RLS work | Postgres performance, index design, RLS policy patterns, query optimisation |

Install new skills via: `claude /plugin install <skill>@<marketplace>`

---

## Build Status

| Area | Status | Notes |
|------|--------|-------|
| Navigation structure | ✅ Built | `AppNavigator`, `AdminStack`, `DriverStack`, `ModeSelectScreen` |
| Mode select screen | ✅ Built | Brand hero, admin/driver split, design system |
| Admin login screen | ✅ Built | Supabase Auth, design system applied |
| Admin dashboard | ✅ Built | Code generation (configurable driver count), job import, active routes |
| Admin route detail | ✅ Built | Per-driver job list, completion status, GPS/photo meta, pull-to-refresh |
| Driver code screen | ✅ Built | 6-digit PIN entry, error states, dark mode |
| Driver route screen | ✅ Built | Job list, status badges, type stripes, progress bar, route-complete hero |
| Driver job screen | ✅ Built | Advancing action button, photo capture, GPS, mark complete |
| `AuthService` | ✅ Built | signIn, signOut, getSession |
| `supabaseClient` | ✅ Built | SecureStore adapter, env vars |
| `RouteCodeService` | ✅ Built | loadSession, generateDailyCodes, getActiveCodes |
| `JobPhotoService` | ✅ Built | capturePhoto, uploadPhoto, getSignedUrl, markJobComplete |
| `GoogleSheetsService` | ✅ Built | importJobs, saveJobsToRoute, token management |
| `useDriverSession` store | ✅ Built | Full state machine — session, uploadStates, canMarkComplete |
| `useAppStore` | ✅ Built | AppMode switching |
| Design system (`colors.ts`) | ✅ Built | Full token set, brand blue, status colours |
| Supabase schema (on-disk) | ✅ Built | `001_initial.sql` is the committed baseline (`supabase db dump --schema public` of prod, captures everything 001–005 created via dashboard). Migrations `006`–`010` are committed AND applied to prod (`supabase db push`, 2026-05-29). Migration history table repaired so 002–005 are marked reverted (their objects live in the baseline). A fresh deploy is now fully reconstructible from git. |
| validate-code Edge Function | ✅ Deployed | Deployed to prod 2026-05-29 (`supabase functions deploy validate-code --no-verify-jwt`). It is the only path to `validate_route_code()` — anon and PUBLIC execute were revoked (008 + 010). |
| Supabase env vars | ✅ Set | `.env.local` exists (gitignored). Verify values point at the right project before any release. |
| iOS permissions | ✅ Built | Camera + location descriptions in `app.json` |
| Session restoration | ✅ Built | Admin session restored on launch via `AppNavigator` |
| Interface style | ✅ Fixed | `automatic` — driver dark / admin light both get correct system chrome |
| Google OAuth2 service | ✅ Built | `GoogleAuthService` + `GoogleConnectScreen` — needs client IDs in `.env.local` |
| Electron shell | ✅ Built | `electron/main.js` — `npm run electron` to launch |
| Photo compression | ✅ Built | Resizes to max 1600px before upload via `expo-image-manipulator` |
| Offline queue | ✅ Built | `OfflineQueueService` + `OfflineBanner` — queues uploads and completions, flushes on reconnect |
| Completion email | ✅ Built | `mailto:` prompt after mark complete — pre-fills agent details |

---

## Environment

| Variable | File | Status |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `.env.local` | ✅ Present (file exists, gitignored; value not inspected per Control table) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` | ✅ Present (file exists, gitignored; value not inspected per Control table) |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS` / `_WEB` | `.env.local` | ⚠️ Required for Sheets import — confirm populated before relying on Google OAuth flow |

---

## Open Decisions

| Decision | Status | Notes |
|---|---|---|
| ~~Admin write RLS policy~~ | ✅ Closed (phantom) | Re-audited 2026-05-27: no admin code writes `jobs.is_complete`. The only writer is the driver path via `complete_job()` RPC (atomic, SECURITY DEFINER, FOR UPDATE row lock). Admins only INSERT jobs (Sheets import, working in v1.0.0) and SELECT. No policy needed. |
| ~~Brand blue exact hex~~ | ✅ Closed (2026-05-31) | Sampled directly from `Sige2site-04.png`; dominant pixel value `#0CAAEC` (HSL 198°/90%/49%). `colors.brand` updated; literal logo blue used on icon/splash/adaptive background. Contrast trade-off documented in `src/utils/colors.ts`. |
| Google Client IDs | Open | Needs Google Cloud Console project → `.env.local` `EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS` / `_WEB`. **Step-by-step setup:** `docs/GOOGLE_OAUTH_SETUP.md`. |
| ~~App icon / splash screen~~ | ✅ Closed (2026-05-31) | Generated from `Sige2site-04.png`: `assets/icon.png` (1024², brand-blue bg, opaque), `splash-icon.png` (2048², transparent), Android adaptive foreground/background/monochrome. Source PNG preserved at `assets/_source/logo-original.png` + `logo-trimmed.png`. Splash and Android adaptive background colours set to brand blue in `app.json`. |
| In-app account deletion (Apple 5.1.1(v)) | ✅ Closed (2026-05-31) | `supabase/functions/delete-admin-account/` deployed-ready (verifies caller JWT, deletes via service role). `AuthService.deleteAccount`. UI: `src/screens/admin/AccountScreen.tsx` reachable from Dashboard → Account. Two-step confirmation, signs out on success. Deploy with `supabase functions deploy delete-admin-account`. |
| Privacy policy + App Privacy labels | ✅ Drafted (2026-05-31) | `PRIVACY.md` ready for publication (3 `{{…}}` placeholders to fill: operator legal name, postal address, contact email). Operator checklist for the App Store Connect questionnaire at `docs/APP_PRIVACY_LABELS.md`. Hosting options listed; policy URL also referenced from `AccountScreen.tsx:PRIVACY_POLICY_URL`. |
| ~~Checked-in schema baseline~~ | ✅ Closed (2026-05-29) | `001_initial.sql` committed from prod dump; migrations 006–010 applied to prod; Edge Function deployed. Fresh deploy reconstructible from git. |
| Rotate exposed credentials | Open | The DB password and an `sb_secret_…` API key were exposed in a working session on 2026-05-29 — rotate both in the dashboard (Settings → Database / API Keys). |
