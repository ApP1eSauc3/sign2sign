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

## 6. Residual gaps (status as of 2026-06-02)

| # | Item | Severity | Status |
|---|---|---|---|
| R1 | `disable_signup` was `false` | **High** | ✅ **Closed 2026-06-02.** PATCH applied via Management API → `disable_signup: true`. Verified: `POST /auth/v1/signup` now returns 422 `signup_disabled`. |
| R2 | Password policy = Supabase default | **High** | ✅ **Closed 2026-06-02.** PATCH → `password_min_length: 12`, `password_required_characters` set to the lower+upper+digit+symbol enum. Caveat: the `/auth/v1/admin/users` endpoint bypasses password policy by design (Supabase behaviour, documented) — so anyone with the service role can still create weak-password users. This matches the threat model (service role = full DB access already), but means admin onboarding scripts should not paste short passwords. Policy IS enforced on the realistic threat surface: self-signup (now disabled anyway), password reset, and self-update. |
| R3 | Leaked-password (HIBP) check off | **Medium** | ✅ **Closed 2026-06-02.** PATCH → `password_hibp_enabled: true`. Password resets / new admin self-update will now be checked against Have I Been Pwned. |
| R4 | MFA not enforced | **Medium** | ✅ **Closed 2026-06-02.** Discovered already-enabled on inspection: `mfa_totp_enroll_enabled: true`, `mfa_totp_verify_enabled: true`. Enrollment surface still needs UI work in `AccountScreen.tsx` (Supabase's `enroll/verify/challenge` MFA API) — not a launch blocker but tracked as R4-followup below. |
| R5 | Captcha on auth not enabled | **Medium** | **Open.** Confirmed: `security_captcha_enabled: false`, `security_captcha_provider: hcaptcha`. Needs an hCaptcha account → site key + secret pasted in dashboard → Auth → Attack Protection. I can wire the API toggle once you give me the site key + secret. |
| R6 | Service-role key + `sb_secret_…` + DB password exposed 2026-05-29 | **High** | **Open**, gated on Liam's go-ahead per the LADE 2026-05-29 handover. Coordination required: rotating service-role JWT invalidates anon-side caches and requires redeploying both edge functions; rotating DB password ripples to every consumer (LADE Lambdas, local dev). |
| R7 | `--no-verify-jwt` for `validate-code` | **Verified** | Intentional and documented; drivers have no JWT. Driver path is hardened by IP throttle + per-client_id DB throttle + RPC SECURITY DEFINER row lock. No change. |
| R8 | Admin login error enumeration | **Mooted** | R1 closes this. With signup disabled and admins created via admin API with `email_confirm: true`, the only enumeration message ("Email not confirmed") is unreachable for production accounts. No code change needed. |
| R9 | No CSP / `X-Frame-Options` on GH Pages policy URL | **Low** | Open. GH Pages can't set custom headers. Revisit when policy moves to `sign2site.com.au/privacy`. |
| R10 | No automated dep-vulnerability scan | **Low** | ✅ **Closed 2026-06-02.** `.github/dependabot.yml` shipped — weekly Perth-time scan of npm + actions, patch+minor batched, majors land individually. |

### Follow-up tracker

- **R4-followup**: MFA enrollment is server-enabled but no UI exists. `AccountScreen.tsx` should grow an "Enable two-factor authentication" row that calls `supabase.auth.mfa.enroll({ factorType: 'totp' })`, renders the returned QR code, and verifies via `supabase.auth.mfa.challenge` + `verify`. Optional for v1; required before customer rollout.
- **R5**: hCaptcha onboarding. ~10 minutes once you have an hCaptcha account.
- **R6**: Credential rotation coordination plan.

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

- [x] ~~Toggle R1–R4 in the Supabase dashboard~~ — applied via
      Management API on 2026-06-02.
- [x] ~~Add CI dependency scan (R10)~~ — Dependabot shipped.
- [ ] R5: wire hCaptcha (needs site key + secret from you).
- [ ] R6: rotate exposed credentials.
- [ ] Smoke-test admin login + account deletion on a real device
      with the production project keys.
- [ ] Resolve the Sign2Site / Sign2Sign domain discrepancy
      (sign2site.com.au vs bryanna@sign2sign.com.au) with the
      customer.

Once shipped, audit cadence: re-run this checklist quarterly or
when adding any of: a new third-party SDK; a new edge function;
a new external auth provider; analytics.
