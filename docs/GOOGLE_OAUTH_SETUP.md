# Google OAuth — Sheets API setup

Sign2Sign's job-import flow reads jobs from a Google Sheet the admin owns.
That requires two OAuth client IDs (one for iOS, one for the Electron
desktop admin), both with the `spreadsheets.readonly` scope. The IDs live
in `.env.local` and ship with the bundle. There is no server-side secret.

The code expects:

```
EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB=...apps.googleusercontent.com
```

Source of truth: `src/services/GoogleAuthService.ts:15-16`.

---

## 1. Pick (or create) the Google Cloud project

Open [console.cloud.google.com](https://console.cloud.google.com/).

- If this is a fresh setup, create a project. Suggested name:
  **sign2sign-prod** (or **sign2site-prod** to align with the customer's
  domain).
- If the customer already has a Google Cloud project for sign2site, use
  that — the OAuth consent screen UX will then show their org name to
  admins signing in.

Note the project ID; you don't need a billing account for the Sheets
API at the volume Sign2Sign uses (under 100 read requests per minute is
in the free tier).

---

## 2. Enable the Sheets API

In the project, go to **APIs & Services → Library → Google Sheets API
→ Enable**.

No other APIs are required. In particular, do **not** enable the Drive
API — the `spreadsheets.readonly` scope is narrower and Apple's review
team prefers the minimum scope.

---

## 3. Configure the OAuth consent screen

**APIs & Services → OAuth consent screen.**

- **User type:** External. (Admins outside the Google Workspace org
  will be signing in.)
- **App name:** Sign2Sign.
- **User support email:** the support address on the privacy policy
  (`{{PRIVACY_CONTACT_EMAIL}}` in `PRIVACY.md`).
- **App logo:** upload `assets/icon.png` (1024×1024, the brand-blue
  icon).
- **Application home page:** `https://sign2site.com.au`.
- **Application privacy policy:** the published URL of `PRIVACY.md`
  (see `docs/APP_PRIVACY_LABELS.md §"Hosting the policy"`).
- **Application terms of service:** optional. Add if you publish one.
- **Authorised domains:** `sign2site.com.au` and the privacy-policy
  host (e.g. `github.io` if you publish on GitHub Pages).
- **Developer contact email:** the same support address.

**Scopes:** add **only** `.../auth/spreadsheets.readonly`. Do not
request user-info or profile scopes — Sign2Sign does not use them.

**Test users** (while the app is in "Testing" publishing status): add
each admin's Google account email. Up to 100 testers.

**Publishing status:** start in **Testing**. Move to **In production**
before App Store submission so any sign2site admin Google account can
authenticate without being on the test-user list. Google's verification
review is required only if you request sensitive scopes
(`spreadsheets.readonly` is non-sensitive — no human review is
triggered).

---

## 4. Create the OAuth client IDs

**APIs & Services → Credentials → Create credentials → OAuth client ID.**

You need two clients. Read `GoogleAuthService.ts:5-14` for the rationale
on credential type — the short version is "no client secret can ship in
a public bundle, so the credential type must be one that doesn't
require one (PKCE only)".

### 4a. iOS client

- **Application type:** iOS.
- **Name:** `sign2sign-ios`.
- **Bundle ID:** `com.liamhowe.sign2sign` (matches
  `app.json:ios.bundleIdentifier`).
- Save. Copy the **Client ID** ending in
  `.apps.googleusercontent.com`.

### 4b. Web / Desktop client (used by Electron and by the token endpoint)

- **Application type:** Desktop app. (Not "Web application" — web
  clients require a client secret on every token call, which we cannot
  ship.)
- **Name:** `sign2sign-desktop`.
- Save. Copy the **Client ID**.

> Why "Desktop" even though the env var is called `_WEB`? The variable
> name is a holdover from the early Expo prototype that used a web
> client with PKCE in development. Both Desktop and iOS client IDs work
> the same way with `expo-auth-session/providers/google`: PKCE +
> redirect URI, no secret. The Desktop client is the right type for the
> Electron build and is what gets exchanged in the token endpoint at
> `GoogleAuthService.ts:45-49`.

---

## 5. Set the redirect URI scheme

The app uses `expo-auth-session` and registers a custom URL scheme. The
scheme is set in `app.json` as `"scheme": "sign2sign"`. The redirect URI
is built by `GoogleAuthService.makeRequest`:

```
sign2sign://oauth
```

Google's Desktop and iOS credential types accept loopback / custom
schemes automatically — there is no separate "authorised redirect URI"
field to fill in for these credential types. (Web clients do require
this; that's another reason not to use a Web client.)

---

## 6. Populate `.env.local`

`.env.local` is gitignored and Human-owned. Add (or update) these
lines, keeping any existing Supabase entries:

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS=<paste the iOS client ID>
EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB=<paste the Desktop client ID>
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=<for geocoding — see AdminDashboardScreen :312>
```

Restart Expo after changing `.env.local` — env values are bundled at
build time and a hot-reload will not pick them up.

---

## 7. Verify

After bundling with the IDs:

1. `npm start` → open on a real iPhone (Simulator can't complete the
   browser redirect cleanly).
2. Sign in as admin.
3. Tap **Connect Google** in the dashboard.
4. The OS browser should open the Google consent screen showing:
   - "Sign2Sign wants to access your Google Account"
   - The privacy policy URL
   - The single scope: "See and download all your Google Sheets
     spreadsheets"
5. Approve. You should return to Sign2Sign and the dashboard pill
   should read **"✓ Google Connected"**.

If anything goes wrong, the most common failures are:

| Symptom | Cause |
|---|---|
| Browser says "Error 400: redirect_uri_mismatch" | The credential type is "Web application". Recreate as "Desktop app". |
| `invalid_client` from `oauth2.googleapis.com/token` | The client ID copied from the console doesn't match the one in `.env.local`. |
| Browser hangs after consent, doesn't return | `app.json` `scheme` is not `sign2sign` or the iOS build wasn't reinstalled after changing it. |
| Works on iOS, fails on Electron | The Desktop client ID is missing from `.env.local`; the iOS one is being used as fallback (`GoogleAuthService.ts:36`). |

---

## 8. Closing this open decision in CODEBASE_STATUS

After the IDs are populated and the connect flow has succeeded on
iPhone and Electron at least once, change `CODEBASE_STATUS.md`:

```
| Google Client IDs | Open | Needs Google Cloud Console project → .env.local … |
```

to:

```
| Google Client IDs | ✅ Closed (YYYY-MM-DD) | Both client IDs populated in .env.local; verified on iOS + Electron. |
```

Do **not** commit `.env.local` — it is gitignored.
