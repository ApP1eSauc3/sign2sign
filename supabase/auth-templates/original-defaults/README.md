# Supabase stock default templates (pre-2026-09-11)

What `mailer_templates_recovery_content` and `mailer_templates_invite_content`
contained before `scripts/apply-auth-templates.js` replaced them on
2026-09-11. Kept so the change is reversible without relying on Supabase's
"reset to default" behaviour.

## Provenance — read this before trusting the files

These were **not** recovered from a backup file. `auth-config-audit.js` wrote
a date-stamped backup, and a verification re-run on the same day overwrote it
with the new content — a real bug in that script, fixed the same day by
timestamping backups to the second and never overwriting.

They were reconstructed from the audit's own terminal output, which had
printed both files in full (each was under the 200-byte preview limit). The
check that they are faithful: the audit independently reported **144** and
**197** bytes before the overwrite, and these files are exactly 144 and 197
bytes. A first reconstruction was 145/198 — a trailing newline that the
originals did not have — and the byte check is what caught it.

That is strong evidence, not proof. If exactness ever matters, Supabase's
dashboard has a per-template "reset to default".

## Restoring

Copy a file over the matching one in `../`, then:

    npm run auth:apply-templates -- --dry-run
    npm run auth:apply-templates

Note `apply-auth-templates.js` refuses any template without `{{ .Token }}`,
which these deliberately lack — restoring them means the app's password-reset
and invite flows stop working, so the guard would have to be bypassed
consciously (edit the file, or set the templates from the dashboard).
