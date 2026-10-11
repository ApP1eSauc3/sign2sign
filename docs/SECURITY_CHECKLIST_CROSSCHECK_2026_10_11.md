# Security checklist cross-check — 2026-10-11

Cross-checks Sign2Sign against **"Mobile App Security Checklist Every Team
Should Follow in 2026"** (AcmeMinds, Medium, published 2026-01-16). Medium
returned `403` to a direct fetch; the full text was read through the
`r.jina.ai` reader on 2026-10-11. The article is a generic list, so each item is
also mapped to the industry standard it paraphrases, **OWASP MASVS v2.1.0**
(latest release, `gh api repos/OWASP/masvs/releases/latest` → `v2.1.0`; control
wording from `OWASP/masvs/controls/*.md`).

**Scope:** the iOS app (Expo SDK 55, Hermes), the macOS Electron admin app,
and the Supabase backend. Android is not a ship target; its rows say so.

**How to read the evidence column** (CLAUDE.md → Documentation Integrity Rule 2):

- **Measured 2026-10-11** means a command was run today and its output is quoted.
- **Code** means `file:line` was read today. It proves what the code does, not
  what is deployed.
- **Last verified <date>** means the fact comes from an earlier dated record and
  was **not** re-measured today.

**Not re-measured today, and why.** The anon-key probes of the live database
and storage bucket (the commands in `docs/LAUNCH_SECURITY_AUDIT_2026_08_18.md`
→ "Verification commands") were refused by this session's permission system as
production reads. Rows that depend on them carry their last verified date. Liam
can re-run them from his own terminal.

---

## Remediation log — 2026-10-11 (same day)

Liam asked for every finding to be fixed except the two client-side tasks
(privacy page hosting, email/DNS). Decisions he made first: Supabase **Pro**,
security log kept **1 year**, admin MFA **optional**, and **Claude builds and
tests, Liam deploys**. So "fixed" below means fixed in the repo and tested
locally; the **Live?** column says what still has to be deployed before the
verdict above changes in production.

| Finding | Fix | Tested | Live? |
|---|---|---|---|
| C-8 / M-1 Electron 41 EOL | `electron` 44.7.0; `LSMinimumSystemVersion` 13.0; `build/stampUpdateMinimumOs.js` stamps `minimumSystemVersion: 22.0.0` (Darwin, which `electron-updater` compares against) into `latest-mac.yml` | Unsigned arm64 build launched, rendered over `app://bundle` (CDP), fuses verified; dev launch clean | ⏳ needs a signed, notarized release |
| C-8 `electron-updater` advisory | 6.8.9 (`builder-util-runtime` 9.7.0); `electron-builder` 26.15.3 removes the `tar` critical from the build machine | `npm audit` full tree: high/critical packages 72 → 41, and those 41 trace to 2 distinct advisories (braces, node-forge), both triaged with no fixed version available | ⏳ same release |
| C-9 always-red audit job | `npm run audit:gate`: allowlist with reasons + `reviewBy`; CI on Node 22; new Deno job | 13 unit tests; gate exits 1 on untriaged and on expired entries (negative-tested) | ✅ on next push |
| G-1 / L-5 no security log | Migration 016 `security_events` + hook + triggers + Edge Function writes; 1-year prune | PGlite: 11/11 (incl. hook never blocks sign-in; audited writes fail closed) | ⏳ `db push`, function deploys, `auth:apply-security` |
| H-3 in-memory IP throttle | Migration 017: per-IP lock in Postgres (30 failures/60s, P0006) | PGlite: 9/9 (rotating device ids still locked; index used) | ⏳ `db push` then redeploy `validate-code` |
| A-1 MFA never offered | Optional TOTP: Account → Security; `MfaChallengeScreen`; MFA-aware password reset; migration 018 makes the DB refuse aal1 for enrolled admins | Jest (service + logic); PGlite 018: 9/9 | ⏳ `db push` (UI ships with next app build) |
| S-1 no session expiry | `npm run auth:apply-security`: 30-day overall / 24h inactivity (NIST 800-63B-4 AAL1) | 12 unit tests; `--skip-hook --dry-run` run | ⏳ needs Pro, then run the script |
| S-2 no re-auth for destructive actions | `_shared/recentAuth.ts` ("sudo mode": password or TOTP in the last 5 min, aal2 if enrolled) in `delete-admin-account` and `invite-admin`; `AccountScreen` re-prompts and retries | 13 Deno tests | ⏳ function deploys |
| P-1 Android permissions | `blockedPermissions` for SYSTEM_ALERT_WINDOW and READ/WRITE_EXTERNAL_STORAGE; `faceIDPermission: false` (the iOS Face ID string had come back through the plugin default) | `npx expo config --type introspect` | ✅ next build |
| Fix 7 anon probes not re-run | `npm run security:probe` (11 probes, read-only) | Fake-fetch tests: hardened passes, each leak fails | ⏳ Liam runs it |

**Correction to P-1 above.** The row says `RECORD_AUDIO` is declared. That
was read from `android/`, which is a **stale prebuild from 2026-04-25**
(gitignored, regenerated on every build). The resolved config already blocked
`RECORD_AUDIO` through `expo-image-picker`'s `microphonePermission: false`.
`SYSTEM_ALERT_WINDOW` and the storage permissions were real. Lesson: inspect
`npx expo config --type introspect`, never the generated native folders.

**Not fixable in code, left open with reasons:** failed admin sign-ins in the
database (needs the Teams-plan Password Verification hook; on Pro they are in
the Auth logs for 7 days), per-account admin lockout (open-work #9, same
hook), external pen test / DAST (M-1), terms of use (L-2, client question),
and forced app updates (U-1, accepted).

---

## Summary

| Verdict | Count |
|---|---|
| Pass | 27 |
| Partial | 12 |
| Fail | 4 |
| N/A (with reason) | 5 |
| **Rows** | **48** |

Counted by script from the tables below. P-1 counts as pass, because iOS is
the platform that ships.

**The findings that matter, most severe first:**

1. **The desktop admin app runs an end-of-life Electron.** Installed
   `electron@41.3.0` (`npm ls electron`). Electron supports the latest three
   stable majors; 44.7.0 is current (`npm view electron version`), and 41
   reached end of life on **2026-08-24** (releases.electronjs.org/schedule).
   So the shipped Mac app's Chromium (M146) no longer receives security
   patches. 42 also reaches end of life on 2026-10-20, so the upgrade target
   is 43 or 44. → fail, item C-8.
2. **`electron-updater`'s advisory is still unpatched.** It is still on 6.8.3,
   with `builder-util-runtime` 9.5.1, which is inside the `<9.7.0` advisory
   range (GHSA-p2f4-r6v6-j797). The 2026-08-21 triage judged it low
   exploitability and flagged the fix; it was never applied. It belongs in the
   same rebuild as finding 1. → item C-8.
3. **No security-event logging** (open-work #7, open since 2026-08-16). → fail, item G-1.
4. **Admin sessions never time out from inactivity, and account deletion
   needs no re-authentication.** `sessions_inactivity_timeout` and
   `sessions_timebox` are both `0`, and `delete-admin-account` accepts any
   valid session. → fail S-1, partial S-2.
5. **MFA is switched on in Supabase but the app never offers it.**
   `mfa_totp_enroll_enabled` is `true`, but there are no `mfa.` calls in
   `src/`, so admin accounts are password-only. → partial, item A-1.
6. **Auth email reaches no one outside the Supabase org** (open-work #32;
   `smtp_host` is null). → partial, item P-4.

---

## Universal checklist: core requirements

| # | Article item | MASVS | Verdict | Evidence |
|---|---|---|---|---|
| C-1 | Secure authentication using industry-standard protocols | AUTH-1 | **partial** | Admins: Supabase Auth (GoTrue) email + password. The policy, measured 2026-10-11 (`npm run auth:audit`), is 12+ characters, four character classes, HIBP on, `disable_signup` true. Drivers: a 6-digit daily code that is the credential by design, validated only through the `validate-code` Edge Function (`validate-code/index.ts:144`). Partial because of MFA; see A-1. |
| C-2 | Encrypted data storage on device | STORAGE-1 | **pass** | Supabase session uses `secureStorage` (`supabaseClient.ts:28`). That is Keychain/Keystore on native through `expo-secure-store`, and OS-keychain `safeStorage` in Electron, which refuses to store plaintext when encryption is unavailable (`electron/main.js:257-258`). The driver route code is in `secureStorage` (`OfflineQueueService.ts:121`). The offline queue in AsyncStorage holds job id, image URI and GPS fix (`OfflineQueueService.ts:20-31`), with no credential. |
| C-3 | Encrypted network communication using HTTPS | NETWORK-1 | **pass** | Measured 2026-10-11 against the project's Supabase host: TLS 1.2 handshake verifies (`ssl_verify_result=0`), TLS 1.1 is refused (curl exit 35), plain HTTP gets `301` to HTTPS, and the cert is from Google Trust Services, valid until 2026-11-24 (it renews automatically). `grep -rn "http://" src electron/main.js app.json app.config.js` finds nothing outside localhost. |
| C-4 | Backend API authentication and authorization | AUTH-1 | **pass** (last verified 2026-08-31) | RLS plus SECURITY DEFINER RPCs. anon has no direct SELECT or UPDATE on `jobs` (migrations 006, 013, 014). Last live verification is from the 2026-08-31 handover; today's re-probe was refused (see top). Measured today: `POST /functions/v1/delete-admin-account` with no credentials returns `401`. |
| C-5 | Secure session management | AUTH-1 | **partial** | See S-1 to S-4. |
| C-6 | Proper error handling and logging | CODE-4 / STORAGE-2 | **partial** | Error handling passes (E-1). Security logging fails (G-1). |
| C-7 | Protection against reverse engineering | RESILIENCE-1..4 | **N/A at this risk level, by profile** | MASTG tags root detection `profiles: [R]` (MASTG-TEST-0045) and pinning `profiles: [L2]` (MASTG-TEST-0022). These are for apps whose threat model includes a hostile device owner, such as banking or DRM. Here the server is the authority, there are no secrets in the bundle (R-3), and drivers hold only a day-scoped code. Hygiene items are scored in R-1 to R-4. |
| C-8 | Secure third-party SDK usage | CODE-3 | **fail** | Measured 2026-10-11, `npm audit --omit=dev`: 47 advisories (1 critical, 33 high, 12 moderate, 1 low), up from 23 on 2026-08-21. Triage, using the method of `DEPENDENCY_AUDIT_2026_08_21.md`: almost all are Metro, Expo CLI and Jest build tooling that never runs on a user's device. Separately from the advisories, the shipped Mac app runs **Electron 41, which is end of life** (Summary 1; `npm audit` does not report end-of-life runtimes). Of the advisories, two reach runtime: (a) **`electron-updater` 6.8.3** (Summary 2), shipped in the Mac app; (b) `nanoid` 3.3.11 through `@react-navigation/routers`, whose advisories need a negative or zero size, but React Navigation calls `nanoid()` with the default size (`node_modules/@react-navigation/routers/lib/module/BaseRouter.js:43`), so it is not reachable. `ws` 8.20.0 under `@supabase/realtime-js` is a Node-only transport. React Native and Electron's renderer use the platform WebSocket. |
| C-9 | Regular security testing and updates | CODE-3 | **partial** | CI runs `tsc`, the tests and `npm audit --audit-level=high` on push, PR and a weekly cron (`.github/workflows/ci.yml:19,55`). Dependabot is active (`DEPENDENCY_AUDIT_2026_08_21.md`). No penetration test or DAST has ever been run. The audit job fails on today's tree, and is meant to as a reminder (`ci.yml:50-54`). But a job that is always red stops being read, so a new runtime advisory would go unnoticed; see fix 6. |

## Certificates and cryptography

| # | Article item | MASVS | Verdict | Evidence |
|---|---|---|---|---|
| T-1 | Valid SSL/TLS certificates for all APIs | NETWORK-1 | **pass** | Measured 2026-10-11 (C-3). Supabase is the only API; Google APIs and GitHub (updater) are vendor-managed. |
| T-2 | TLS 1.2 or higher | NETWORK-1 | **pass** | Measured 2026-10-11: TLS 1.1 refused, TLS 1.2 accepted. |
| T-3 | Certificate validation enforced on the client | NETWORK-1 | **pass** | Code: no `NSAllowsArbitraryLoads`. The prebuild output has it `false` (`ios/sign2sign/Info.plist:46-47`; `ios/` is generated from `app.json` and gitignored, so this reflects prebuild, not a committed file). `grep` for `rejectUnauthorized\|setCertificateVerifyProc\|certificate-error` in `electron/` finds nothing, so Chromium's default validation applies. |
| T-4 | Certificate pinning for sensitive APIs | NETWORK-2 | **N/A, by profile** | MASVS-NETWORK-2 is an L2 control (MASTG-TEST-0022/0068 `profiles: [L2]`). Pinning Supabase's Google-issued certificate would mean shipping app updates whenever Supabase rotates certificates, a common cause of outages for apps that pin. Revisit only if the threat model gains interception on managed networks. |
| T-5 | Strong encryption standards for stored data | CRYPTO-1 | **pass** | No custom cryptography in `src/`. Keychain/Keystore and Electron `safeStorage` (OS keychain) handle it. Supabase encrypts at rest (provider default). |
| T-6 | Secure key management using platform keystores | CRYPTO-2 | **pass** | Same as C-2. The service-role key exists only in Edge Function secrets: `grep -rn "service_role\|SERVICE_ROLE" src App.tsx electron app.config.js` finds 0 hits (measured 2026-10-11). |

## Permissions and privacy

| # | Article item | MASVS | Verdict | Evidence |
|---|---|---|---|---|
| P-1 | Request only permissions required | PRIVACY-1 | **pass (iOS)**, **partial (Android, not shipped)** | iOS asks for camera and location-when-in-use only (`Info.plist:51-54`). There is no microphone and no background location. `app.json` `android.permissions` lists CAMERA and FINE/COARSE location. The generated Android manifest still adds `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` from dependencies (`android/app/src/main/AndroidManifest.xml:7-8`); `PRIVACY.md` already discloses the first. If Android ever ships, add `android.blockedPermissions` in `app.json` (Human-owned). |
| P-2 | Avoid install-time permission requests | PRIVACY-1 | **pass** | Camera is requested when a photo is first taken (`JobPhotoService.ts:67`), and location when the upload starts (`DriverJobScreen.tsx:109`). iOS has no install-time prompts. |
| P-3 | Explain permission usage clearly | PRIVACY-3 | **pass** | Usage strings name the purpose (`Info.plist:52,54`). |
| P-4 | Review permissions and data as features change | PRIVACY-3 | **partial** | Done today: `PRIVACY.md` corrected (stale driver-email flow, an unimplemented sign-in notice, and an imprecise retention window). Still open: Resend (#32) and Google Maps Platform (#31) are not in the sub-processor list. Correct for today, because neither is live, but each must be added the day it ships. |
| P-5 | Do not collect data that is not required | PRIVACY-1 | **pass** | GPS is a single fix at upload time, not tracked (`CLAUDE.md` → GPS timing). EXIF is stripped by an unconditional re-encode (`JobPhotoService.ts:86-107`). No analytics or ads SDKs (`PRIVACY.md` §2, checked against `package.json`). |
| P-6 | Follow platform privacy guidelines | PRIVACY-3 | **pass** | `app.json` `privacyManifests` declares collected types and required-reason APIs. App Privacy labels are in `docs/APP_PRIVACY_LABELS.md`. The policy URL is reachable: `200`, measured 2026-10-11. It is moving to the client's domain (handover → 2026-10-11). |

## Compliance readiness

| # | Article item | MASVS | Verdict | Evidence |
|---|---|---|---|---|
| L-1 | User consent for data collection | PRIVACY-3 | **pass** | OS permission prompts gate camera and location. Admins are invited, not self-signed-up. |
| L-2 | Clear privacy policy and terms | PRIVACY-3 | **partial** | The privacy policy exists and is linked in-app (`AccountScreen.tsx:32,159`). There are **no terms of use**. For an internal workforce tool distributed to staff, an employment or contractor agreement usually covers this, so treat it as a question for the client, not a code task. |
| L-3 | Secure handling of PII | STORAGE-1 | **pass** (last verified 2026-08-31 for the live grants) | Photos are in a private bucket with an 8 MiB cap and an image MIME allowlist (`009_storage_policies.sql:31-42`). Viewing uses 1-hour signed URLs only (`JobPhotoService.ts:201`). |
| L-4 | Data retention and deletion policies | PRIVACY-4 | **partial** | Implemented: code attempts are pruned nightly (`007_prune_code_attempts.sql:29-32`), and `PRIVACY.md` §6 now states the real ~48-hour bound. Not implemented: orphaned storage blobs (#22). The policy promises no photo-deletion schedule, which is correct because nothing implements one. |
| L-5 | Audit-friendly logging and access controls | AUTH-1 | **fail** | Access controls pass (C-4). Logging fails: see G-1 below. |
| L-6 | Support data access and deletion requests | PRIVACY-4 | **pass** | In-app admin account deletion (`delete-admin-account`, deployed v8, `supabase functions list` 2026-10-11). Other requests go by email to a named contact (`PRIVACY.md` §7); that the mailbox exists is unconfirmed (#18, in the client request). |

## The article's nine detailed sections

| # | Article item | MASVS | Verdict | Evidence |
|---|---|---|---|---|
| A-1 | OAuth 2.0 / OIDC; strong passwords; MFA where appropriate | AUTH-1 | **partial** | Strong passwords: pass (C-1). MFA: TOTP enrolment and verification are enabled server-side (`mfa_totp_enroll_enabled: true`, measured 2026-10-11), but `grep -rn "mfa\." src` finds nothing, so no admin can enrol. Admins can delete data and mint driver codes, so TOTP for admins is "appropriate" here. |
| A-2 | Short-lived access tokens | AUTH-1 | **pass** | `jwt_exp` 3600 (measured 2026-10-11), which is Supabase's recommended default. Refresh-token rotation is on, with a 10-second reuse window. |
| A-3 | Role-based access control enforced server-side | AUTH-1 | **pass** (last verified 2026-08-31) | Two roles: anon (driver), scoped through SECURITY DEFINER RPCs that validate the code, and `authenticated` (admin) under RLS (`011_admin_delete_incomplete_jobs.sql:28`). Edge Functions re-resolve the caller with `auth.getUser` rather than trusting the JWT signature (`delete-admin-account/index.ts:154`, `invite-admin/index.ts:13-15`). |
| D-1 | Data at rest only in Keychain/Keystore; don't store what you don't need | STORAGE-1 | **pass** | C-2. |
| N-1 | HTTPS everywhere, no insecure fallback | NETWORK-1 | **pass** | C-3 and T-3. The production Electron CSP `connect-src` lists only `'self'`, `https://` and `wss://` origins (`electron/main.js:314-316`). |
| H-1 | Every API authenticates requests | AUTH-1 | **pass** | `validate-code` is the one deliberately unauthenticated endpoint; the code in the body is the credential. Everything else needs a session (C-4). |
| H-2 | Validate inputs | CODE-4 | **pass** | `validate-code`: 1 KiB body cap checked against both Content-Length and bytes read (`supabase/functions/validate-code/index.ts:42,126-133`), and a `^\d{6}$` check (`:118`). Sheets imports are capped at 500 rows, with per-field length caps (`sheets/rowMapper.ts:3,11-13`). The set-password form mirrors the server policy (committed `7197771`). |
| H-3 | Rate limiting | AUTH-1 | **partial** | Driver codes: a durable per-device lock of 5 failures in 60 seconds in Postgres (`006_rate_limit_codes.sql:59-85`), plus a per-IP limit of 30 per 60 seconds. **The per-IP limit is an in-memory Map inside one Edge Function instance** (`validate-code/index.ts:37-52`), so it resets on cold start and isn't shared across instances; the database lock is the real control. Admin sign-in uses GoTrue's per-IP limits with no per-account lockout (last verified 2026-08-18, audit pt.2 #17). Email: `rate_limit_email_sent` is 2 per hour on the built-in mailer and rises to 30 with custom SMTP. |
| H-4 | Don't expose internal logic or identifiers | CODE-4 | **pass** (last verified 2026-08-19) | `validate-code` no longer returns raw Postgres errors. `validate_route_code` returns an explicit column list (audit 2026-08-18, pt.1 #17). |
| S-1 | Sessions expire after inactivity | AUTH-1 | **fail** | `sessions_inactivity_timeout: 0` and `sessions_timebox: 0` (measured 2026-10-11). Supabase documents both as "only available on Pro Plans and up"; the project's plan was not checked. A refresh token keeps an admin signed in indefinitely on that device. |
| S-2 | Re-authentication for sensitive actions | AUTH-3 | **partial** | Password change happens only through the emailed-code reset, which is itself fresh proof. **Account deletion and admin invite need only a live session.** Changing `security_update_password_require_reauthentication` (now `false`) would not cover these. They need an in-app password re-prompt before calling the function. |
| S-3 | Bind to device or context where appropriate | AUTH-1 | **N/A** | Supabase sessions are bearer tokens. Device binding would need DPoP-style infrastructure Supabase doesn't offer. The driver code is already day-scoped and throttled per device. |
| S-4 | Invalidate on logout or credential change | AUTH-1 | **pass** | `AuthService.signOut` calls `supabase.auth.signOut()` (`AuthService.ts:80`), whose default scope is `'global'` (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:3153`), so it revokes every session's refresh token. A failed reset also signs out (`AuthService.ts:228`). |
| R-1 | Code obfuscation | RESILIENCE-3 | **N/A, by profile** | The R profile (C-7). Hermes ships bytecode, not JS source (`ios/Podfile.properties.json` → `expo.jsEngine: hermes`). That is an obstacle to reverse engineering, not obfuscation. |
| R-2 | Remove debug logs in production | STORAGE-2 | **pass** | Five `console.*` calls in `src/` (excluding tests). All log GoTrue or loader error messages, never a password, code or token (`AuthService.ts:75,108,137,229`, `useDriverSession.ts:92`). The Electron DevTools menu item is added only when `isDev` (`electron/main.js:464`), and the custom menu replaces the default (`:484`). |
| R-3 | No hardcoded secrets | STORAGE-2 | **pass** | Measured 2026-10-11: the only client env vars are `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and two Google OAuth client IDs, all of which are designed to be public. The Maps key is server-side only. `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` survives only in comments that say it is gone. `.env.local` and `electron-build.env` are gitignored (`git check-ignore`), and `git log --all` over env, pem, p12 and p8 files returns nothing. |
| R-4 | Rooted/jailbroken device detection | RESILIENCE-1 | **N/A, by profile** | C-7. No detection library is present, and that is a deliberate choice, not an oversight. |
| E-1 | Don't expose internal errors to users | CODE-4 | **pass** | Admin sign-in collapses every failure to "Invalid email or password." (`AuthService.ts:75-76`), which also prevents account enumeration. Set-password shows GoTrue's own policy messages, which are user-facing by design (verified live 2026-10-11, HIBP message). |
| G-1 | Centralised server-side logging and monitoring | — | **fail** | No security-event log exists: no record of admin sign-in success or failure, account deletion, job deletion, or throttle trips. `code_attempts` is the only trail and it is pruned at 24 hours. Open-work #7. Supabase's own Auth and Edge Function logs exist in the dashboard, but nobody reviews them and nothing alerts on them. |
| M-1 | Pen testing, automated scans, runtime monitoring, fast patching, training | CODE-3 | **partial** | Automated: CI `npm audit` and Dependabot (C-9). Manual: dated audits on 2026-06-01, 2026-08-18 and today. No external pen test, no DAST, no runtime monitoring or crash reporting. "Fast patching" failed twice: the `electron-updater` fix was flagged on 2026-08-21 and not shipped, and Electron 41 went end of life on 2026-08-24 unnoticed. |
| U-1 | Enforce app updates *(MASVS-CODE-2, implied by "fast patching")* | CODE-2 | **partial** | Mac: `electron-updater` checks GitHub Releases on launch (`electron/main.js:530-534`). It notifies but does not force. iOS: no minimum-version gate. Fine for one client's staff, provided whoever distributes builds keeps them current. |

---

## Proposed fixes — not done, waiting on Liam

Ranked by risk reduced per hour. Owner follows CLAUDE.md → Control. Nothing
here has been changed.

| # | Fix | Owner / why it is not done here |
|---|---|---|
| 1 | Upgrade Electron 41 → 43 or 44 and `electron-updater` → ≥ 6.8.9 in one release; rebuild, notarize and smoke-test the Mac app | `electron/` and release are **Human**; needs the notarization credentials (`electron-build.env`). Electron 42 is not a target, since it reaches end of life on 2026-10-20. |
| 2 | Security-event logging (open-work #7): an `admin_audit_log` table written by the Edge Functions and the delete and import paths, with a retention window that `PRIVACY.md` then states | New migration `016_*` (flag before writing). Liam picks the retention window first. |
| 3 | Re-prompt for the password before account deletion and admin invite | `src/screens/` is Collaborative; small and app-only, no deploy. |
| 4 | Admin TOTP MFA (enrol on the Account screen; challenge at sign-in) | Collaborative screens plus `AuthService`. The server side is already on. Decide first whether it is optional or required for admins. |
| 5 | Inactivity timeout for admin sessions | Dashboard setting; needs the Pro plan. Check the plan, then pick a value, for example 7 days. |
| 6 | Make the weekly `npm audit` CI job meaningful: scope it to `--omit=dev`, or keep an allowlist of triaged tooling advisories so a new runtime advisory turns it red | `.github/` is not in the Control table; ask first. |
| 7 | Re-run the anon-surface probes (`LAUNCH_SECURITY_AUDIT_2026_08_18.md` → "Verification commands") and record the date | Liam's terminal; this session was refused production reads. |
| 8 | Set Supabase `site_url` from `http://localhost:3000` to a real URL | Low: the templates carry only `{{ .Token }}`, so nothing links to it today. Dashboard or Management API, Liam. |
| 9 | If Android ever ships: `blockedPermissions` for `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` | `app.json` is **Human**. |

---

## Re-running this check

```bash
npm run auth:audit                                   # auth policy, sessions, SMTP verdict
npm audit --omit=dev --json                          # then triage: what actually ships?
npm ls electron electron-updater builder-util-runtime
npm view electron version                            # compare with the installed major
curl -s https://releases.electronjs.org/schedule     # EOL dates
supabase functions list                              # deployed versions
```
