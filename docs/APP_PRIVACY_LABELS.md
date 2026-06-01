# App Store Connect — App Privacy answers (Sign2Sign)

This is the operator's checklist for the **App Privacy** ("nutrition
label") questionnaire in App Store Connect. Each row maps an App Store
Connect data category to the answer for Sign2Sign and the source-of-truth
file we verified it against.

Apple flow: App Store Connect → My Apps → Sign2Sign → **App Privacy** →
**Get Started** → answer each data-type question, then publish.

**Privacy policy URL** (Apple field): the published URL of
`PRIVACY.md` — see §"Hosting the policy" at the bottom of this file.

---

## Section 1 — Does this app collect data?

**Answer: Yes.**

The app collects photos, GPS, admin email, and an agent email per job.
See the table below.

---

## Section 2 — Data types collected

For each data type Apple lists, answer **Collected** or **Not Collected**,
then for each "Collected" type answer the four follow-up questions
(linked to user, used for tracking, purposes, optional).

| Apple data type | Collected? | Linked to user? | Used for tracking? | Purposes | Notes / source |
|---|---|---|---|---|---|
| **Contact info → Email address** | ✅ Yes (admins) | ✅ Linked | ❌ No | App Functionality | Admin Supabase Auth login. `AuthService.ts:6`. |
| **Contact info → Email address** *(second entry for agent_email — Apple allows separate purpose mapping)* | ✅ Yes (agents) | ✅ Linked | ❌ No | App Functionality | Agent email imported from a Google Sheet by an admin; pre-fills the completion mailto on job completion. `JobPhotoService.ts` + `GoogleSheetsService.ts:agent_email`. |
| Contact info → Name, phone, address, other user contact info | ❌ Not collected | — | — | — | — |
| **User content → Photos or videos** | ✅ Yes | ✅ Linked | ❌ No | App Functionality | Camera photo per job; mandatory before "Mark complete". `JobPhotoService.ts:capturePhoto` → `uploadPhoto`. |
| User content → Audio data | ❌ Not collected | — | — | — | Android `RECORD_AUDIO` permission is declared by an Expo dependency but not exercised by Sign2Sign code (verified by `grep` 2026-05-31). |
| User content → Customer support, other user content | ❌ Not collected | — | — | — | — |
| **Location → Precise location** | ✅ Yes | ✅ Linked | ❌ No | App Functionality | Single GPS fix at the moment of photo upload; no background or continuous tracking. `DriverJobScreen.tsx → Location.getCurrentPositionAsync`. |
| Location → Coarse location | ❌ Not collected | — | — | — | Coarse permission is requested on Android only so the OS can downgrade if the user denies fine; the app reads `getCurrentPositionAsync` with Balanced accuracy. |
| **Identifiers → User ID** | ✅ Yes (admin) | ✅ Linked | ❌ No | App Functionality | Supabase Auth user UUID — internal to the admin account. |
| **Identifiers → Device ID** | ✅ Yes (driver) | ❌ Not linked | ❌ No | App Functionality (fraud prevention) | A random UUID generated on first launch, stored in SecureStore, sent with code-validation to enforce per-device rate limits. Not linked to any identity. `RouteCodeService.ts:CLIENT_ID_KEY`. |
| Health & Fitness | ❌ Not collected | — | — | — | — |
| Financial info | ❌ Not collected | — | — | — | — |
| Sensitive info | ❌ Not collected | — | — | — | — |
| Contacts | ❌ Not collected | — | — | — | — |
| Browsing history | ❌ Not collected | — | — | — | — |
| Search history | ❌ Not collected | — | — | — | — |
| Usage data (Product interaction, ad data, other usage) | ❌ Not collected | — | — | — | No analytics SDK. Verified — no `amplitude`, `segment`, `mixpanel`, `firebase/analytics`, `sentry`, `posthog` import in `src/`. |
| Diagnostics (Crash data, performance, other) | ❌ Not collected | — | — | — | No crash-reporting SDK. (Apple's own opt-in crash reports go to App Store Connect under your developer account, not via the app's privacy declaration.) |
| Purchases | ❌ Not collected | — | — | — | — |
| Other data | ❌ Not collected | — | — | — | — |

### Tracking

Sign2Sign **does not track users** as Apple defines tracking (linking
user/device data to data from other companies' apps/sites for ads or
data brokerage). All "Linked to user" entries above answer **No** to
"Used for tracking".

---

## Section 3 — Purposes (canonical answers)

For each Collected data type Apple asks: pick one or more purposes.
Sign2Sign uses only one:

- **App Functionality** — the data is necessary for the feature to
  work (you cannot mark a job complete without a photo; the agent
  email is needed to send the completion email; the GPS coordinate is
  the verification record).

Do **not** check Analytics, Product Personalization, Developer's
Advertising, Third-Party Advertising, Other Purposes — none apply.

---

## Section 4 — Optional disclosure

Apple lets you mark a data type as **optional** if the user can use
the app without providing it. For Sign2Sign:

- **Admin email / password** — required to use admin features. Not optional.
- **Photo** — required to complete a job. Not optional.
- **GPS** — required to complete a job. Not optional (job-completion
  uses a single fix at upload; the user can deny location at OS level,
  in which case the app surfaces a clear error and they cannot mark
  complete).
- **Agent email** — not provided by the user; comes from the Sheet
  import. Mark as required per job.
- **Anonymous device ID** — generated by the app. Not user-provided;
  no optionality.

---

## Section 5 — Privacy policy URL

Apple requires a public URL. Set it to wherever you publish `PRIVACY.md`.

---

## Hosting the policy

**Current host (live since 2026-05-31):** GitHub Pages off the public
`ApP1eSauc3/sign2sign` repo, built from `main` / `/`. Policy URL:

```
https://app1esauc3.github.io/sign2sign/PRIVACY
```

This is the URL wired into `src/screens/admin/AccountScreen.tsx`
(`PRIVACY_POLICY_URL`) and is the URL to paste into App Store Connect.

**Migration path (recommended before full production):** move the
policy to `https://sign2site.com.au/privacy` once the customer's CMS is
ready. When you do, update both:

1. `PRIVACY_POLICY_URL` in `AccountScreen.tsx`.
2. The Apple field in App Store Connect → App Privacy.

The GitHub Pages copy can stay live as a redundant mirror — no harm.

---

## Before submitting the questionnaire

- [ ] Fill `{{OPERATOR_LEGAL_NAME}}`, `{{POSTAL_ADDRESS}}`, and
      `{{PRIVACY_CONTACT_EMAIL}}` placeholders in `PRIVACY.md`.
- [ ] Publish the policy at the chosen URL.
- [ ] Open the URL in a private browser — confirm it loads without a
      sign-in wall.
- [ ] In App Store Connect, paste the URL into **App Privacy → Privacy
      Policy** and the build's metadata.
- [ ] Walk the App Privacy questionnaire using the table in §2 above.
- [ ] Save & Publish.

---

## When to revisit this document

Any time you change the data the app handles. Specifically:

- Adding an analytics or crash-reporting SDK → re-answer Usage data /
  Diagnostics.
- Adding push notifications or any device-token system → re-answer
  Identifiers → Device ID and possibly add a category.
- Adding background location → re-answer Location.
- Adding any third-party SDK that calls home → audit and re-answer
  Tracking.

Update both `PRIVACY.md` and this file at the same time.
