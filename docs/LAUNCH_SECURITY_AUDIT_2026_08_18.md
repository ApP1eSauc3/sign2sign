# Launch Security Audit — 2026-08-18

40-item pre-launch hardening pass (`launch-security` skill), run against Sign2Sign at
commit `35dd35b`. Item numbering is the skill's item map — pt.1 #1–20 and pt.2 #1–20.

**Method.** Three verification lanes:

1. **Repo** — source read + the skill's verify greps. Evidence is `file:line` or command output.
2. **Live** — probes against the prod Supabase project with the anon key, run 2026-08-18.
   The anon key was sourced into the shell environment and never printed.
3. **Dashboard** — Supabase Auth settings that cannot be read from here. Marked
   `unverified`, never `pass`. Per Documentation Integrity rule 2, a deployed-state
   claim needs a date and a method; guessing is worse than an honest gap.

No `db push`, no `functions deploy`, no edits to Human-owned files were made.

**Score at audit time (2026-08-18): 20 pass · 4 fail · 6 partial · 3 unverified · 7 N/A**
(40 total; the blocker below is not a checklist item and is not counted). The failures are
concentrated in operational follow-through (deploy, logging, dependency triage), not
in the security model, which is unusually strong for a project this size.

**After the 2026-08-19 remediation: 20 pass · 4 fixed · 2 fail · 4 partial · 3 unverified ·
7 N/A.** Both numbers are kept deliberately — the first is what the audit found, the second
is where the repo stands. Counting the verdict cells in the tables below gives the second.

---

## Remediation log — 2026-08-19

Seven items applied in code the day after the audit. `npx tsc --noEmit` clean,
`npm test` 60/60 green, `npm run verify:electron` clean.

| Item | Change | File |
|---|---|---|
| PT1 #9 | Route code moved out of plaintext `AsyncStorage` into `secureStorage` under its own key; it is no longer part of the persisted op and is passed to flush handlers at call time. Queue bulk stays in `AsyncStorage` — a Keychain item is the wrong place for a growing list of file URIs. | `src/services/OfflineQueueService.ts`, `src/stores/useDriverSession.ts` |
| PT2 #13 | Photo re-encode is now unconditional, so EXIF/GPS is stripped even when no resize is needed. | `src/services/JobPhotoService.ts` |
| PT2 #5 | Every `signIn` failure returns one string; the real reason goes to the console pending real security logging. | `src/services/AuthService.ts` |
| PT1 #17 | `validate-code` no longer returns raw Postgres error text to unauthenticated callers. | `supabase/functions/validate-code/index.ts` |
| PT2 #11 | 1 KiB body cap in `validate-code`, enforced on both `Content-Length` and read length. | `supabase/functions/validate-code/index.ts` |
| PT1 #18 | `X-Content-Type-Options: nosniff` on `app://` document and asset responses. | `electron/main.js` |
| PT1 #15 | Agent address percent-encoded in the mailto URL (`@` left literal). | `src/screens/driver/DriverJobScreen.tsx` |
| PT1 #20 | CI added — `npm ci`, `tsc --noEmit`, `npm test`, `npm audit --audit-level=high`, electron syntax check; on push, PR, and weekly. | `.github/workflows/ci.yml` |

**Two of these need a deploy to take effect.** The `validate-code` changes are code
only until `supabase functions deploy validate-code --no-verify-jwt` is run — the same
built≠deployed trap this audit found in PT2 #14. The `electron/main.js` header ships with
the next desktop build.

**The audit job will fail on first run.** That is intended, not an oversight: 42
advisories are outstanding and unfixed. The job exists so the number is visible on every
PR instead of only when someone remembers to look.

Still open after this pass: the blocker below, PT2 #14 (deploy), PT2 #18 (security
logging), PT2 #20 (grants), PT2 #17 (admin lockout), the three dashboard items, and
`npm audit` triage.

---

## Blocker found while verifying — not a checklist item

**`anon` cannot UPDATE `public.jobs` in production. The driver photo-upload path is
broken.**

```
PATCH /rest/v1/jobs?id=eq.<uuid>   apikey: <anon>   Prefer: return=minimal
  {"photo_key":"jobs/x/1.jpg","photo_gps_lat":1,"photo_gps_lng":2,"photo_timestamp":"..."}
→ 401 {"code":"42501","message":"permission denied for table jobs"}
```

Control, same shape, against `route_codes` (which kept a partial SELECT grant in
migration 006): `→ 204`.

`JobPhotoService.uploadPhoto` (`src/services/JobPhotoService.ts:110-118`) issues exactly
that call as `anon`. It cannot succeed today.

**Cause.** Migration `006_rate_limit_codes.sql:191` does
`revoke select on table public.jobs from anon`, removing anon's SELECT on *every* column.
PostgREST compiles `.eq('id', jobId)` into a `WHERE id = …` predicate, and Postgres
requires SELECT privilege on any column referenced in a WHERE clause — including on an
UPDATE. The column-level `GRANT UPDATE(photo_key, …)` grants from the baseline are
intact; the filter is what's denied.

Migration `012_offline_sync_grace.sql` confirms this reading: it drops and recreates the
`"Drivers can update photo fields for active jobs"` policy with the 24h grace window, and
adds **no grants at all**. So the policy is live and permissive while the grant layer
rejects the request before it is ever consulted.

Note what this means for the docs: `src/services/CLAUDE.md` → RLS table claims
"Write `jobs` — photo fields directly … ✅ via the driver UPDATE policy". That row
describes the *policy*, which does permit it — but the *grant* layer rejects the request
before RLS is ever consulted. Documentation Integrity rule 5: the doc and the code agreed
with each other and both were wrong about reality. The third source — the live database —
settled it.

**Why the tests didn't catch it.** All 60 tests pass (`npm test`, 2026-08-18), but every
one mocks the Supabase client. Nothing in the suite exercises real grants or RLS.

**Recommended fix** — a `record_job_photo()` SECURITY DEFINER RPC, matching the pattern
already used by `validate_route_code`, `recover_existing_photo`, and `complete_job`. It
keeps anon's SELECT on `jobs` revoked and re-validates route ownership server-side, which
a restored `GRANT SELECT (id)` would not:

```sql
-- 013_record_job_photo.sql  (sketch — needs review before writing)
create or replace function public.record_job_photo(
  p_job_id uuid, p_route_code text, p_photo_key text,
  p_lat double precision, p_lng double precision, p_taken_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$ … $$;
```

The route-code check should use the same 24h grace window as `complete_job` (migration
012), or an offline queue that flushes after expiry will fail on the photo but succeed on
the completion.

---

## Part 1 — items 1–20

> Rows marked **fixed 2026-08-19** keep their original Evidence and Fix text — that is the
> finding as it stood at audit time, and an audit row is a record, not a status board. What
> changed is in the remediation log above.

| # | Item | Verdict | Evidence | Fix |
|---|---|---|---|---|
| 1 | Hide API keys | **pass** | `grep -rn "service_role\|SERVICE_ROLE\|supabaseServiceKey" src/ App.tsx electron/ app.config.js` → 0 hits. Only `EXPO_PUBLIC_*` (publishable) reach the bundle: `src/services/supabaseClient.ts:4-5`. Service role read from function env: `supabase/functions/validate-code/index.ts:55`. `.env.local` gitignored (`.gitignore:41`). | — |
| 2 | Purge Git secrets | **pass** | `git log --all -- .env .env.local '*.pem' '*.p12' electron-build.env` → no commits. `git rev-list --objects --all \| grep -Ei "\.env\|tfvars\|\.pem$\|\.p12$\|keystore"` → no matches. Working tree scan for `sk_live\|AKIA\|BEGIN PRIVATE KEY` → clean. | Add a `gitleaks protect --staged` pre-commit hook so it can't recur. |
| 3 | Use public DB key | **pass** | Client uses anon only (`supabaseClient.ts:26`). Live probe confirms anon is RLS-constrained, not privileged: `GET /rest/v1/jobs` → `401 42501 permission denied`. | — |
| 4 | Enable row-level security | **pass** | `jobs`, `route_codes` (`001_initial.sql:365,371`), `code_attempts` (`006:52`). Live 2026-08-18: anon SELECT on `jobs` → 42501; on `route_codes.code` → 42501; on allowed columns → `200 []`; on `code_attempts` → `200 []` (RLS-enabled, zero policies). | — |
| 5 | Encrypt sensitive data | **pass** | Supabase at-rest default; TLS enforced (see #19). Tokens: iOS Keychain / Android Keystore via `expo-secure-store`, Electron via OS-keychain `safeStorage` IPC (`src/utils/secureStorage.ts:38-85`, `electron/main.js` `secure-get`/`secure-set`). Photo bucket private (`009_storage_policies.sql:31-42`). | Plaintext driver-credential exposure is filed under #9. |
| 6 | Enforce server-side auth | **pass** | RLS + SECURITY DEFINER RPCs are the authority; `delete-admin-account/index.ts:143` re-validates the JWT with `auth.getUser()` and derives `user.id` from the token, never the body. Live: unauthenticated POST → `401 {"error":"missing_authorization"}`. | — |
| 7 | Lock record access (IDOR) | **pass** | `complete_job` and `recover_existing_photo` both scope by `route_code_id = v_route_id` after validating the code (`012_offline_sync_grace.sql`, `006:145-159`) — a job id from another route returns `job_not_found`. Storage: anon has INSERT only, scoped to the `jobs/` prefix, no SELECT/LIST (`009:52-62`). Live: anon `POST /storage/v1/object/list/job-photos` → `200 []`. | — |
| 8 | Block field tampering | **pass** | Column-level grants restrict anon to `is_complete`, `photo_key`, `photo_gps_lat/lng`, `photo_timestamp` (`001_initial.sql:441-469`). Four triggers back it: photo write-once, is_complete monotonic, photo-required-for-complete, duplicate-location (`001:260-281`). `is_complete` moves only through `complete_job()` with a `FOR UPDATE` row lock. | — |
| 9 | Secure session cookies / token storage | **fixed 2026-08-19** | The 6-digit route code **is** the driver credential, and `OfflineQueueService` writes it into `AsyncStorage` — unencrypted — as `routeCode` on every queued op (`src/services/OfflineQueueService.ts:5, 13, 19, 41`). It survives the session and can land in a device backup. The admin session is correctly stored (see #5). | Store the queue through `secureStorage`, or keep only `jobId` + `type` in the queue and read the code from the in-memory session at flush time. |
| 10 | Hash passwords | **pass** | Delegated to Supabase Auth (bcrypt). No password column in any migration; no password reaches a log (`grep -rniE "console\.(log\|warn\|error)" src/ \| grep -i password` → 0). Drivers have no passwords at all. | — |
| 11 | Rate limit login | **partial** | Driver: two independent throttles — per-IP 30/60s in the Edge Function (`validate-code/index.ts:32-33`) and per-`client_id` 5-failed/60s in the DB (`006:79-88`). Admin: relies entirely on Supabase Auth's built-in limits, which are **dashboard config nobody has checked**. | Read Auth → Rate Limits in the dashboard and record the values with a date. |
| 12 | Add bot protection | **pass (accepted)** | Live: `disable_signup: true` (`GET /auth/v1/settings`); `POST /auth/v1/signup` → `422 signup_disabled`. With no self-serve signup and two operator accounts, the main bot-abuse surface doesn't exist. No CAPTCHA/App Attest — proportionate here. | Optional: enable Supabase Auth CAPTCHA on the login endpoint. |
| 13 | Parameterize queries | **pass** | supabase-js query builder throughout. `grep -rnE "\.(rpc\|or\|filter)\(\`" src/` → 0 hits (no template-literal PostgREST filters). All plpgsql functions use bound parameters; no `EXECUTE format(...)` anywhere in `supabase/migrations/`. | — |
| 14 | Validate all input | **pass** | `validate-code/index.ts:94-102` type-checks and regex-validates (`/^\d{6}$/`) before the RPC. `GoogleSheetsService.ts:6,160` caps imports at 500 rows. `DriverCodeScreen.tsx:67-68` — `number-pad`, `maxLength={6}`. | Minor: Sheets-derived strings (`address`, `client_name`) get no length cap before insert — the column type is the only bound. |
| 15 | Escape user content | **pass** (note fixed 2026-08-19) | React Native/JSX escapes by default. `grep -rn "dangerouslySetInnerHTML\|innerHTML\|WebView" src/ electron/` → 0 hits. Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (`electron/main.js` `webPreferences`). | Minor: `DriverJobScreen.tsx:150` interpolates `agentEmail` into a `mailto:` URL unencoded while subject and body are `encodeURIComponent`'d — a sheet value containing `&` or `?` injects extra mailto params. Wrap it. |
| 16 | Restrict file uploads | **pass** | Server-side, on the bucket: private, `file_size_limit` 8 MiB, `allowed_mime_types` jpeg/png/webp (`009:31-42`). Client filename never trusted — key is server-shaped `jobs/${jobId}/${ts}.${ext}` with an extension allowlist (`JobPhotoService.ts:12-29`). anon INSERT constrained to the `jobs/` prefix (`009:52-57`). | — |
| 17 | Trim API responses | **pass** (note fixed 2026-08-19) | `validate_route_code` returns an explicit column list, not `SELECT *` (`006:107-109`). Admin `select('*')` calls (`RouteCodeService.ts:254,271`) run under an authenticated session over data the admin owns. | `validate-code/index.ts:116` returns the raw Postgres `error.message` to an unauthenticated caller on `rpc_error`. Return a generic string; log the detail. |
| 18 | Add security headers | **pass** (note fixed 2026-08-19) | Electron ships a strict per-response CSP from the `app://` handler (`electron/main.js` `buildContentSecurityPolicy`): prod `script-src` drops both `'unsafe-inline'` and `'unsafe-eval'`; `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`. `style-src 'unsafe-inline'` is a documented react-native-web trade-off. | Add `X-Content-Type-Options: nosniff` to the `app://` asset responses — one line, no downside. |
| 19 | Force HTTPS | **pass** | `ios/sign2sign/Info.plist:45-47` — `NSAllowsArbitraryLoads = false`. CSP `connect-src` is `https:`/`wss:` only. `grep -rn "http://" src/ app.json electron/` → nothing but a DTD URL in a plist. Android cleartext appears only in the `debug`/`debugOptimized` manifest variants, never release. | — |
| 20 | Scan dependencies | **partial — CI added 2026-08-19** | `npm audit` 2026-08-18: **42 vulnerabilities (2 critical, 33 high)**; `--omit=dev`: 26 (1 critical). Dependabot is configured (`.github/dependabot.yml`) but there is **no CI workflow** — `.github/` contains only that file, so nothing runs `npm audit` or `npm test` on a push. | Triage, don't blanket-upgrade. Most of the count is build tooling that never ships (`metro`, `@expo/cli`, `electron-builder`, `ws`, `shell-quote`). The one that **does** ship is `electron-updater` → `builder-util-runtime`, which runs in the packaged desktop app. Start there, then add a CI workflow running `npm ci && npm audit --audit-level=high && npm test`. |

---

## Part 2 — items 1–20

> Rows marked **fixed 2026-08-19** keep their original Evidence and Fix text — that is the
> finding as it stood at audit time, and an audit row is a record, not a status board. What
> changed is in the remediation log above.

| # | Item | Verdict | Evidence | Fix |
|---|---|---|---|---|
| 1 | Add HSTS | **N/A** | No hosted web origin exists. Electron serves the bundle over the custom `app://` scheme; iOS talks directly to Supabase, which sets its own HSTS. | Re-scope if a hosted web admin ever ships. |
| 2 | Add CSRF tokens | **N/A** | Bearer-token auth with no cookie session anywhere. Per the skill's §4 precondition, CSRF does not apply — an attacker's page cannot set an `Authorization` header. | — |
| 3 | Reset sessions on password change | **unverified** | No code path calls `signOut({ scope: 'others' })`; admin password changes happen through Supabase's own flow, where refresh-token revocation is a project setting. Cannot be read from here. | Check Auth → Sessions/Tokens in the dashboard; confirm refresh-token rotation and reuse detection are on. Record the date. |
| 4 | Expire reset links | **unverified** | No in-app forgot-password flow exists; resets go through Supabase email. The OTP/link TTL is a dashboard setting. | Confirm the OTP expiry (default 1h; shorten to 15–30 min) and record it. |
| 5 | Prevent user enumeration | **fixed 2026-08-19** | Signup oracle is closed — live `disable_signup: true`. But `AdminLoginScreen.tsx:42` renders `authError.message` verbatim; Supabase's "Invalid login credentials" is generic, while "Email not confirmed" is not, and it distinguishes a registered address. | Map every `signIn` failure to one string — "Invalid email or password." — and log the real reason. |
| 6 | Whitelist upload types | **pass** | Same control as pt.1 #16 — `allowed_mime_types` enforced by the bucket, not by the client picker. | — |
| 7 | Verify payment webhooks | **N/A** | No payments, no webhook endpoints. | — |
| 8 | Set prices server-side | **N/A** | No commerce surface. | — |
| 9 | Block prompt injection | **N/A** | No LLM anywhere in the product. | — |
| 10 | Cap AI usage | **N/A** | Same. | — |
| 11 | Limit request size | **fixed 2026-08-19** | Uploads capped server-side at 8 MiB by the bucket (`009:36`). `validate-code` parsed an unbounded body. **Correction to the first draft of this row:** it claimed "neither Edge Function" — in fact `delete-admin-account` never reads a request body at all (it works from the `Authorization` header), so there was nothing there to cap. Only `validate-code` was affected. | Fixed: 1 KiB cap in `validate-code`, enforced twice — `Content-Length` up front, then a length check on the read text, because a chunked request sends no `Content-Length` and would otherwise slip the header check. |
| 12 | Rate limit password resets | **unverified** | Supabase's built-in email rate limits apply; no in-app reset flow to add limits to. Dashboard values unread. | Same dashboard pass as #3/#4. |
| 13 | Sanitize before storing | **fixed 2026-08-19** | Photos are re-encoded through `expo-image-manipulator`, which drops EXIF — **but only when a resize is needed** (`JobPhotoService.ts:65-82`). A photo already ≤1600px on both axes is uploaded as the original camera asset, EXIF and embedded GPS intact. | Always run `manipulateAsync` (a no-op resize still re-encodes). The app already records GPS deliberately in its own columns; the EXIF copy is unmanaged exposure. |
| 14 | Lock down CORS | **fail (built ✅ / deployed ❌)** | The allowlist is in the source (`delete-admin-account/index.ts:86`, commit `b091e12`). The **live function still returns the wildcard** — verified 2026-08-18: `curl -X OPTIONS $URL/functions/v1/delete-admin-account -H "Origin: https://evil.example"` → `access-control-allow-origin: *`, and no `Vary: Origin`. The commit was never deployed. | `supabase functions deploy delete-admin-account` (Human-run), then re-run that curl. Severity is genuinely low — bearer auth, no `Allow-Credentials`, so the worst case is a page burning a visitor's throttle budget. The *pattern* is what matters: this is the 2026-05-29 built≠deployed failure class recurring. |
| 15 | Disable directory listing | **pass** | The `app://` handler resolves inside `dist/` and rejects traversal (`resolved.startsWith(root + path.sep)` check in `electron/main.js`), returns 404 for anything unreadable, and never enumerates. No web root exists to list. | — |
| 16 | Remove default admin routes | **pass** | No framework admin panel, no debug endpoint, no GraphQL. `grep -rniE "admin@\|password123\|changeme\|test@test\|demo@" src/ supabase/ docs/` → 0 hits. Self-serve signup disabled at the project level. | — |
| 17 | Lock accounts after failed logins | **partial** | Driver side is properly done — per-`client_id` 5-failed/60s **and** per-IP 30/60s, two keys as the skill prescribes. Admin side has no per-account lockout; only Supabase's IP-level limits. | Acceptable for two operator accounts, but it should be a recorded decision rather than an oversight. |
| 18 | Log security events | **fail** | No structured security logging exists. `code_attempts` is the only audit trail, and `007_prune_code_attempts.sql` deletes rows older than 24h via pg_cron. Nothing records admin login success/failure, job deletion, account deletion, or Edge Function throttle trips. | Log to Supabase's function logs at minimum: failed code validations with IP, throttle trips, and every `delete-admin-account` invocation. Then decide a retention window and make sure `PRIVACY.md` matches it. |
| 19 | Set secure cookie flags | **N/A** | Merged with pt.1 #9 by the skill's item map — no cookies anywhere. The device-storage equivalent is scored there, and it fails. | See #9. |
| 20 | Restrict database permissions | **partial** | The baseline carries broad grants that later migrations only partly walked back. `001_initial.sql:432` grants anon `SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, MAINTAIN` on `jobs`; `001:476` grants anon `ALL` on `route_codes`. Migration 006 revoked **only SELECT**. Live proof the grants are still there: anon INSERT fails with `"new row violates row-level security policy"` — an *RLS* rejection, not `permission denied`, meaning the request passed the grant layer. Worse, `001:526-527` and `001:536-537` set `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon`, so **every future table auto-grants ALL to anon** — migration 013 is one forgotten `ENABLE ROW LEVEL SECURITY` away from a public table. | A `013` that revokes the unused write grants from anon on both tables, and `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon`. Note this interacts with the blocker above — decide the `record_job_photo()` RPC first, then write one migration that does both. |

---

## What to do, grouped by who does it

> **Tracking lives elsewhere.** These items are folded into
> `ELECTRON_HARDENING_HANDOVER.md` → `## Open work — authoritative list (2026-08-19)`,
> which is the single place outstanding work is tracked. The grouping below is the
> audit's view of it; the handover list is the one to work from, and it carries the
> doc-invalidation column this section doesn't.

### Claude-fixable (code only, no deploy)

1. **Driver credential in plaintext** (#9) — move the offline queue to `secureStorage`, or drop `routeCode` from the persisted shape.
2. **EXIF always stripped** (pt.2 #13) — remove the `needsResize` condition around `manipulateAsync`.
3. **Generic login error** (pt.2 #5) — one string for every `signIn` failure.
4. **Edge Function response hygiene** (pt.1 #17, pt.2 #11) — generic `rpc_error` message; `Content-Length` guard before `req.json()`.
5. **`nosniff` on `app://` responses** (pt.1 #18) — one header.
6. **Encode `agentEmail`** in the mailto URL (pt.1 #15).
7. **CI workflow** (pt.1 #20) — `npm ci && npm audit --audit-level=high && npm test`.

### Needs a decision, then a migration (flag before writing — Human-owned surface)

8. **`record_job_photo()` RPC** — the blocker. Nothing about the driver flow works without it.
9. **Grant tightening + default-privileges revoke** (pt.2 #20) — same migration.

### Liam only — deploy

10. `supabase functions deploy delete-admin-account` (pt.2 #14), then re-run the OPTIONS curl.

### Liam only — dashboard

11. Auth rate limits (pt.1 #11), refresh-token rotation / reuse detection (pt.2 #3), OTP expiry (pt.2 #4, pt.2 #12). Record each value with today's date.

### Triage

12. `npm audit` — start with `electron-updater` → `builder-util-runtime`, the one advisory that reaches a shipped artifact.

---

## Verification commands, for re-running

```bash
# anon surface (source .env.local into env; never echo it)
set -a; . ./.env.local; set +a
U="$EXPO_PUBLIC_SUPABASE_URL"; K="$EXPO_PUBLIC_SUPABASE_ANON_KEY"

curl -s "$U/rest/v1/jobs?select=*&limit=1"       -H "apikey: $K" -H "Authorization: Bearer $K"
curl -s "$U/rest/v1/route_codes?select=code"     -H "apikey: $K" -H "Authorization: Bearer $K"
curl -s -X POST "$U/rest/v1/rpc/validate_route_code" -H "apikey: $K" -H "Authorization: Bearer $K" \
     -H 'Content-Type: application/json' -d '{"p_code":"000000","p_client_id":"00000000-0000-0000-0000-000000000000"}'
# all three must return 42501

# the blocker — must become 204 once record_job_photo() ships
curl -s -X PATCH "$U/rest/v1/jobs?id=eq.00000000-0000-0000-0000-000000000000" \
     -H "apikey: $K" -H "Authorization: Bearer $K" -H 'Content-Type: application/json' \
     -H 'Prefer: return=minimal' -d '{"photo_key":"jobs/x/1.jpg"}'

# CORS — must stop echoing '*' after the deploy
curl -sI -X OPTIONS "$U/functions/v1/delete-admin-account" -H "Origin: https://evil.example" \
  | grep -i "access-control\|vary"
```

**Not verified in this pass, and worth knowing:** anon UPDATE on `route_codes` could not
be proven denied at the row level — there were no live route codes to test against, so
the probe matched zero rows and returned `204` either way. The migrations show no anon
UPDATE policy on that table, so RLS should deny it; re-run the PATCH against a real
`route_codes.id` the next time a code is active, and confirm `is_active` is unchanged.
