# Sign2Sign — Security Audit, 2026-06-01

Scope: admin auth path (Supabase Auth, JWT, edge functions),
account-deletion endpoint, transport security, secret handling.
Driver-side guardrails (migrations 006–010, validate-code Edge
Function, rate limits in DB) were already audited and shipped on
2026-05-29; this pass focuses on what changed since (the new
`delete-admin-account` function, App Store prep, and follow-on
checks on the rest of the admin path).

Method: each finding is paired with the evidence it came from
(curl output, code reference, dashboard setting). No claim is
inferred from defaults alone.

---

## 1. Smoke test — `delete-admin-account`

Throwaway user admin-created via `/auth/v1/admin/users` with
`email_confirm: true`, signed in via password grant, then six
cases exercised against the deployed function.

| # | Case | Expected | Observed | Pass |
|---|---|---|---|---|
| 1 | Happy POST + valid Bearer | 200, `{deleted:true,user_id}` | 200, body matches | ✅ |
| 2 | `auth.users` row after delete | 404 from admin API | 404 `User not found` | ✅ |
| 3 | POST, no Authorization header | 401 | 401 `UNAUTHORIZED_NO_AUTH_HEADER` (gateway) | ✅ |
| 4 | POST, malformed Bearer | 401 | 401 `UNAUTHORIZED_INVALID_JWT_FORMAT` (gateway) | ✅ |
| 5 | POST, replay deleted user's token | 401 | 401 `{"error":"invalid_token"}` (function) | ✅ |
| 6 | GET (wrong method) | 405 | 405 `method_not_allowed` | ✅ |

The split between gateway-emitted 401s (cases 3, 4) and
function-emitted 401 (case 5) is meaningful: the Supabase Edge
Functions gateway runs JWT signature verification on
`verify_jwt: true` functions before our code executes. Our
function's explicit `auth.getUser(token)` call adds the
"user no longer exists" rejection on top of signature check.

## 2. Transport (TLS / HSTS)

| Endpoint | TLS | HSTS | Notes |
|---|---|---|---|
| `heynyjopyociaozqnauz.supabase.co/functions/v1/*` | HTTP/2, cert from Google Trust Services, valid through 2026-07-29 | `max-age=31536000; includeSubDomains; preload` | Cloudflare-fronted |
| `heynyjopyociaozqnauz.supabase.co/auth/v1/*` | same | same | — |
| `app1esauc3.github.io/sign2sign/PRIVACY` | HTTP/2 | `max-age=31556952` (~1y) | GH Pages enforces HTTPS |

HTTPS is mandatory across all three. No mixed-content surface
identified.

## 3. Authentication settings (public `/auth/v1/settings` snapshot)

```
disable_signup:     false
mailer_autoconfirm: false   ← email confirmation required ✅
phone_autoconfirm:  false
external providers: email only
saml_enabled:       false
passkeys_enabled:   false
anonymous_users:    false   ← random anon sessions disabled ✅
```

The two non-public settings that matter are:

| Setting | Where to check | Recommendation |
|---|---|---|
| `disable_signup` | Dashboard → Authentication → Sign in / Up → Email | **Set true.** This is an admin-only system; the customer's admin accounts should be created out-of-band (dashboard or admin API), not by anyone with the anon key reaching `/auth/v1/signup`. |
| Password policy (min length, required character classes) | Dashboard → Authentication → Sign in / Up → Password | **Min 12, require letters + numbers + symbols.** Default min is 6 — too weak for an admin credential controlling the route-code factory. |
| Leaked-password protection (HIBP) | same panel | **Enable.** Free in Supabase; blocks signups/resets that match a known-leaked password. |
| MFA (TOTP) | Dashboard → Authentication → MFA | **Enable, opt-in.** TOTP requires no additional infra. Not a blocker for v1 submission, but a strong "before you ship to a paying customer" item. |
| Captcha on auth endpoints | Dashboard → Authentication → Attack Protection | **Enable hCaptcha** before public launch — Supabase's built-in IP throttles are the primary defence, but captcha closes the brute-force loop. |

These are dashboard toggles — no migration or code change needed.
They cannot be set from the codebase, so they sit as residual
gaps in §6 below.

## 4. Hardening shipped this pass (`delete-admin-account`)

Two changes deployed (2026-06-01) on top of the initial deploy:

- **CORS preflight handler + headers.** Native iOS and Electron
  don't trigger preflights; this is for any future web admin.
  `Access-Control-Allow-Origin: *` is acceptable because the
  function requires a Bearer JWT signed by the project — origin
  cannot substitute for authentication. Verified: OPTIONS now
  returns 204 with `access-control-allow-methods: POST, OPTIONS`.
- **In-memory IP throttle.** Mirrors `validate-code` pattern.
  Window 60 s, ceiling 6 requests. A legitimate admin self-deletes
  at most once, so 6/min is generous. The throttle only kicks in
  for requests that pass gateway JWT verification (because
  malformed-JWT requests never reach the function) — i.e. it's
  defence against replay of a captured valid token, which is the
  real threat model.

Both verified live against
`https://heynyjopyociaozqnauz.supabase.co/functions/v1/delete-admin-account`.

## 5. Session storage on the client

| Layer | Storage | Reviewed |
|---|---|---|
| iOS / Android | `expo-secure-store` (Keychain / Keystore) via `src/utils/secureStorage.ts` | Yes |
| Electron | OS keychain (`keytar` via the same adapter) | Yes |
| Web (Expo web) | `localStorage` fallback | Yes — acceptable because the admin path is not currently shipped on Expo web |

`supabase.auth.persistSession: true` (`src/services/supabaseClient.ts:29`)
with the SecureStore adapter — sessions are encrypted at rest on
native and protected by the OS keychain on desktop. Service-role
key is never bundled (confirmed by `grep` over `src/` and
`package.json` — only the anon key is present).

## 6. Residual gaps (severity + recommendation)

| # | Item | Severity | Recommendation |
|---|---|---|---|
| R1 | `disable_signup` is `false` (public can hit `/auth/v1/signup`) | **High** | Set true in dashboard. Confirm AdminLoginScreen still works (it doesn't call signup). Without this, anyone with the bundled anon key + Supabase URL can create a parallel `auth.users` row — they wouldn't get any RLS-protected data, but it muddies your audit trail and consumes email quota. |
| R2 | Password policy = Supabase default | **High** | Dashboard → Authentication → Password: min 12, require letters + numbers + symbols. Document in admin onboarding so the customer's IT person picks a real password. |
| R3 | Leaked-password (HIBP) check off | **Medium** | Dashboard toggle, free. |
| R4 | MFA not enforced | **Medium** | Enable TOTP; surface the enrollment URL in AccountScreen later. Not a launch blocker but recommended before the customer goes live. |
| R5 | Captcha on auth not enabled | **Medium** | Enable hCaptcha before public launch. Built-in rate limits help but captcha closes the brute-force loop. |
| R6 | Supabase service-role key + `sb_secret_…` + DB password exposed in working session on 2026-05-29 | **High** | Pending Liam's go-ahead per the LADE 2026-05-29 handover. Rotate all three in dashboard → Settings → API / Database. The new `delete-admin-account` function picks up the new service-role key automatically on next deploy. |
| R7 | `--no-verify-jwt` posture audit for `validate-code` | **Verified** | Intentional and documented; drivers have no JWT. Driver path is hardened by IP throttle + per-client_id DB throttle + RPC SECURITY DEFINER row lock. No change. |
| R8 | Admin login screen — error message enumeration | **Low** | Supabase Auth returns the same generic error for "wrong password" vs "no such user". Code in `AdminLoginScreen.tsx` surfaces `error.message` directly — fine for now (Supabase already generalises it). Re-check if you ever switch to a self-hosted auth provider. |
| R9 | No CSP / `X-Frame-Options` on the GitHub Pages policy URL | **Low** | The policy is a static markdown page. GitHub Pages doesn't let you set custom headers without a CDN in front. Not worth solving for a privacy policy; revisit if you move to `sign2site.com.au/privacy`. |
| R10 | Expo deps: `expo-network`, `expo-location`, etc. — no automated dep-vulnerability scan in CI | **Low** | `npm audit` shows the current state. Wire a `Dependabot` config or a `gh actions` step on the repo to surface advisories. |

## 7. Industry-standard mappings

For the portfolio submission to Moonward, these are the
frameworks this audit lines up against:

- **OWASP MASVS L1** (mobile app security baseline): the storage,
  transport, and auth controls in §2–§5 cover the L1 control set.
  Remaining: MSTG-AUTH-9 (MFA — see R4) and MSTG-AUTH-2 (password
  policy — see R2).
- **Apple App Store guideline 5.1.1(v)** (account deletion in-app):
  shipped, smoke-tested in §1.
- **Australian Privacy Principles 1, 6, 11, 12, 13**: addressed by
  `PRIVACY.md` (APP 1 — open disclosure, APP 11 — security of
  personal information). APP 12/13 (access + correction) lives in
  PRIVACY.md §7 with a contact path to bryanna@sign2sign.com.au.

## 8. What "complete and production-ready" looks like

Before App Store submission:

- [ ] Toggle R1–R5 in the Supabase dashboard.
- [ ] Rotate exposed credentials (R6).
- [ ] Smoke-test admin login + account deletion on a real device
      with the production project keys.
- [ ] Resolve the Sign2Site / Sign2Sign domain discrepancy
      (sign2site.com.au vs bryanna@sign2sign.com.au) with the
      customer.
- [ ] Add CI dependency scan (R10) — not a blocker but cheap.

Once shipped, audit cadence: re-run this checklist quarterly or
when adding any of: a new third-party SDK; a new edge function;
a new external auth provider; analytics.
