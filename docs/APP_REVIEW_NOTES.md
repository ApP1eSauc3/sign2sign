# App Review Notes — paste into App Store Connect

Pastes verbatim into **App Store Connect → App Information → App Review
Information → Notes** when submitting Sign2Sign for review. Fill the
three `<<…>>` placeholders before submitting. Total length is under
2,000 characters (ASC's limit is 4,000).

Two reasons this doc exists:
1. The driver "codeless" auth pattern looks unusual to a reviewer; the
   note pre-empts a "How do I create a driver account?" reject.
2. The Google OAuth flow is for a data connector, not for app login;
   the note pre-empts a Guideline 4.8 (Sign in with Apple) mis-flag.

When you submit a new build, also fill the **Demo Account** fields in
ASC (one level above the Notes field) with the admin credentials and
the active driver code.

---

## Paste-able text

```
Sign2Sign is a field-operations tool for sign installation and removal
crews. There are two user types in one binary, switched at the launch
screen:

1. Admins (office staff)
   Auth: email + password via Supabase Auth.
   To test, use the demo account in the Demo Account field above:
     Email:    <<DEMO_ADMIN_EMAIL>>
     Password: <<DEMO_ADMIN_PASSWORD>>
   From the dashboard you can: generate today's 6-digit driver codes,
   import jobs from a Google Sheet, and review per-route progress.

2. Drivers (field crew)
   Drivers do NOT have user accounts. They enter a 6-digit daily code
   provided by the dispatcher (the admin generates the code, then
   verbally tells the driver). The code expires automatically and is
   the credential. This pattern matches contractor / field-ops apps
   and is intentional — drivers don't have email addresses or
   passwords on the system.

   To test the driver flow, choose "Driver" at the launch screen and
   enter this active code:
     Code: <<DEMO_DRIVER_CODE>>

About the Google OAuth flow:
The app has an optional "Connect Google" button on the admin dashboard
that opens an OAuth consent screen for the single scope
"https://www.googleapis.com/auth/spreadsheets.readonly". This is used
ONLY to read a job list from a Google Sheet the admin owns when they
choose to import jobs. It is NOT used to authenticate users into
Sign2Sign — admin login is email/password as described above. This
falls under Guideline 4.8's carve-out for third-party APIs used for
purposes other than login, so Sign in with Apple is not applicable.
You do not need to test the Google connector to review the app.

Permissions requested at runtime:
- Camera: required for drivers to photograph completed installs and
  removals. A photo is mandatory before a job can be marked complete.
- Location (When In Use): the GPS coordinate at the moment of photo
  capture is recorded with the photo so the office can verify the work
  was photographed at the correct address. No background or continuous
  location tracking.

Account deletion (Guideline 5.1.1(v)): admins can delete their account
in-app via Dashboard → Account → Delete account…, then "Delete
forever". The server-side delete is permanent and immediate. Drivers
have no account to delete; uninstalling the app removes the local
session.

Data collection: photos, GPS, admin email, agent email. Full inventory
in the privacy policy at https://app1esauc3.github.io/sign2sign/PRIVACY
and reflected in the App Privacy questionnaire.

Contact for review questions: bryanna@sign2sign.com.au
```

---

## How to fill the placeholders

| Placeholder | What to put |
|---|---|
| `<<DEMO_ADMIN_EMAIL>>` | A real, dedicated **reviewer-only** admin account on the prod Supabase project. Suggestion: `apple-reviewer@sign2sign.com.au`. Create it via the admin API (with `email_confirm: true`) — the dashboard signup flow is now disabled. |
| `<<DEMO_ADMIN_PASSWORD>>` | A strong password matching the policy now enforced (≥12 chars, lower + upper + digits + symbols). Do NOT reuse Bryanna's password. Rotate after each Apple review cycle. |
| `<<DEMO_DRIVER_CODE>>` | A live 6-digit code for one of today's driver slots on the reviewer-only route. **Codes expire daily**, so this needs to be refreshed at the moment of submission and any resubmission. Easiest pattern: generate the reviewer's driver code immediately before clicking "Submit for Review", then again before each resubmission. Apple's review usually happens within 24–48 hours of submission; if the code expires during review, they'll reject and you regenerate. |

## ASC sibling fields to fill while you're there

While on the ASC submission screen, also fill:

- **Demo Account** (top of the same panel): paste
  `<<DEMO_ADMIN_EMAIL>>` / `<<DEMO_ADMIN_PASSWORD>>`. Apple's reviewer
  uses these fields automatically for some review automation; the
  Notes field is the verbose supplement.
- **Contact Information**: name + email of someone who can answer in
  English within 24 hours of an Apple message. For this project that's
  you (Liam) or Bryanna.
- **Sign-in required**: yes (admin path) — but driver path requires
  only a code, which is fine because Apple treats codes as a separate
  category from accounts.
- **Notes** (the field this doc is for): paste the Paste-able text
  block above.

## When to re-edit this doc

- Anytime the driver code expiration window changes.
- Anytime the demo admin account is rotated (suggested after every
  Apple review pass).
- If the Google OAuth scope or purpose changes — re-check the
  Guideline 4.8 framing.
- If you add any third-party login (then you may actually need SIWA
  and this note becomes wrong).

## Why this doc lives in the repo

Reviewer notes are part of the submission artifact, like the privacy
policy. Keeping them in `docs/` means they're versioned alongside the
code that triggered them, and the next person submitting (you, future
Liam, or Moonward reviewing the portfolio) doesn't have to re-derive
the framing from scratch.
