# Auth email templates

These two templates are the **blocking dependency** for both email-code flows
(password reset and admin invite). See `ELECTRON_HARDENING_HANDOVER.md` →
"Invite + password-reset runbook".

## Why they exist as files

The stock Supabase Recovery and Invite templates carry only
`{{ .ConfirmationURL }}`. The app never follows that link — it reads the
numeric `{{ .Token }}` (length set by `mailer_otp_length`; 8 as of 2026-10-10) — so both templates must be replaced. Keeping them
here rather than only in the dashboard means they are reviewable, diffable,
and re-appliable after any project restore.

| File | Dashboard template | Management API field |
|---|---|---|
| `recovery.html` | Reset Password | `mailer_templates_recovery_content` |
| `invite.html` | Invite user | `mailer_templates_invite_content` |

## Applying them

```bash
export SUPABASE_ACCESS_TOKEN=…   # supabase.com/dashboard/account/tokens
node scripts/auth-config-audit.js          # read first — also backs up the current templates
node scripts/apply-auth-templates.js --dry-run
node scripts/apply-auth-templates.js
```

`apply-auth-templates.js` refuses to run unless each file contains
`{{ .Token }}`, since a template without it silently breaks both flows in a way
no test catches.

## Constraints these files are written to

- **Inline styles only.** Gmail strips `<style>` blocks; there is no CSS class
  in here that matters.
- **No external images or fonts.** Mail clients block remote images by default,
  and a remote fetch is a read receipt the recipient did not consent to.
- **No link.** Deliberate: a link that lands on `SiteURL` and does nothing is
  worse than no link, and its presence invites the phishing-shaped habit of
  clicking a button in an email about your password.
- **No hardcoded expiry.** How long a code lasts is `mailer_otp_exp`, which
  lives in project config, not here. `auth-config-audit.js` reads the real
  value; the copy says "expires shortly" so the email can never contradict it
  (CLAUDE.md Documentation Integrity Rule 4).
