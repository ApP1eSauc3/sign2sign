# Sign2Sign — Handover (Electron + Project)

**Status:** v1.0.0 **shipped** (2026-05-26 → 2026-05-27). Notarized, stapled, published to GitHub Releases. Auto-updater channel live. Every original Electron hardening task plus every originally-out-of-scope item is implemented.

**Last touched:** 2026-05-27 — audit + doc cleanup pass (see "What changed 2026-05-27" below).

**Release:** https://github.com/ApP1eSauc3/sign2sign/releases/tag/v1.0.0

This document supersedes the original Haiku tasking sheet (see `## Implementation history` at the end). What you need to ship the next release is at the top. The Electron hardening content (the bulk of this file) is unchanged from v1.0.0; the project-wide status section was added 2026-05-27.

---

## What changed 2026-05-27 (audit + cleanup)

Triggered by a "what's left before publishable / any hallucinations?" review. The app code itself was not modified — only docs, one `electron-builder.yml` line, and one comment block. Full diff is in the working tree (uncommitted at time of writing).

### Audit findings — fixed in place

| Finding | Fix |
|---|---|
| `mac.artifactName` durable fix (handover gotcha #3) was still deferred — every release needed a manual `sed` on `latest-mac.yml` or the auto-updater 404'd | Added `artifactName: Sign2Sign-Admin-${version}-${arch}.${ext}` under `mac:` in `electron-builder.yml`. Gotcha #3 below is now marked RESOLVED with historical context preserved. |
| `electron-builder.yml` notarization comments still named `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` — the project actually switched to App Store Connect API key (`APPLE_API_KEY`/`_KEY_ID`/`_ISSUER`) | Comment block rewritten to match reality. |
| `CLAUDE.md` referenced `supabase/migrations/001_initial.sql` in 5 places — the file does not exist on disk or in git history (migrations 001–005 were applied via the Supabase dashboard before this repo's git history began) | Replaced each reference with accurate "006_–009_ on disk; baseline lives only in prod" notes. Added a "Schema Section" rewrite that flags the missing baseline as a TODO. |
| `CLAUDE.md` tagged three built services/stores as `(when built)` (`useDriverSession.ts`, `GoogleSheetsService.ts`, `JobPhotoService.ts`) | Tags removed. |
| `CLAUDE.md` driver-auth section still described direct anon `SELECT` on `route_codes` — that path was revoked by migration `008_revoke_rpc_from_anon.sql`; drivers now go through the `validate-code` Edge Function | Paragraph rewritten to reflect the Edge Function + RPC reality, including which RPCs anon can still call. |
| `src/services/CLAUDE.md` driver-auth code example showed the revoked direct query | Replaced with the real `fetch` shape (verified against `RouteCodeService.loadSession`). RLS table rewritten with 6 accurate rows. |
| `src/data/CLAUDE.md` instructed "verify against `001_initial.sql`" | Pointed at on-disk migrations + `RouteCodeService.ts` typed shape. |
| `README.md` directory tree named four migration files (`001_initial.sql` → `004_admin_read_jobs.sql`) that don't exist on disk | Replaced with the real list (006_–009_) plus the `validate-code` Edge Function. |
| `README.md` migration example said next-free was `005_…` — but 005 is "taken" (applied in dashboard) | Corrected to `010_…`. |
| `SKILLS.md` had a "✅ Built — Admin write RLS policy in `002_rls_write_policies.sql`" entry that was wrong on two counts: the file isn't on disk *and* admins never write `is_complete` (only the driver path via `complete_job()` RPC does) | Rewrote as "Driver write RLS on jobs" with the actual mechanism. |
| `CODEBASE_STATUS.md` had "Admin write RLS policy" as an Open Decision — same phantom as above | Marked Closed (phantom). Added the legitimate "Checked-in schema baseline" Open Decision instead. |
| `CODEBASE_STATUS.md` env-var statuses said "needs real value" — `.env.local` exists (file checked, contents not read per Control table) | Updated to ✅ Present with the caveat. |

### Stress test results (2026-05-27)

- `npx tsc --noEmit` — clean, exit 0 (re-run after all edits)
- `npm run verify:electron` — clean (`node --check` on `electron/main.js` + `build/afterPack.js`)
- `electron-builder.yml` parsed via `js-yaml` — valid, `mac.artifactName` reads back correctly
- Service-role-key claim ("never shipped in the app") verified by grep — only present in `supabase/functions/validate-code/index.ts` (Deno-side, env-injected)
- Final cross-doc grep for `001_initial`, `002_rls_write`, `003_code_management`, `004_admin_read`, `005_add_column`, `when built`, `sed.*latest-mac`, `APPLE_APP_SPECIFIC` — every remaining hit is a deliberate TODO that names the file as missing, not a claim that it exists

### Open blockers for "publishable" (not done — need user action)

1. ~~**Schema baseline not in git.**~~ **RESOLVED 2026-05-29.** CLI logged in + linked. `001_initial.sql` committed (prod dump). Critically, this revealed migrations `006_–009_` and the `validate-code` Edge Function had **never been deployed** (CLI was never logged in, so `db push` / `functions deploy` never ran) — prod was running the insecure pre-006 schema and driver login was broken. Now fixed: Edge Function deployed, `006_–010_` applied via `db push` (010 is a new fix closing a PUBLIC-execute bypass that 008 missed). Migration history repaired (002–005 marked reverted; their objects live in the baseline). Live verification confirmed: `code` column hidden from anon, anon SELECT on `jobs` revoked, anon/PUBLIC execute on `validate_route_code` revoked, RPC + rate-limit table functioning.
2. **Zero test coverage.** `TESTING.md` describes a setup that hasn't been installed. For production confidence the photo-gate (`canMarkComplete`) and `RouteCodeService.loadSession` error paths (429, network failure, null session) should have happy-path coverage.
3. **Brand assets still placeholders.** `assets/icon.png` and the splash are Expo defaults. CLAUDE.md tags `assets/` as Human-owned.
4. **Brand blue hex unconfirmed.** Currently the `#147EC4` estimate in `src/utils/colors.ts`. Confirm by inspecting sign2site.com.au CSS.
5. **Google Client IDs in `.env.local`.** Required for the Sheets import flow. Status uncertain without reading the file (Human-owned).
6. **Windows build deferred.** No Windows code-signing cert. If a Windows admin user is in scope, this becomes a blocker.

---

## What shipped in v1.0.0

| Hardening | Status | Lives in |
|---|---|---|
| IPC sender validation (Electron checklist #17) | ✅ | `electron/main.js` — `validateSender()` |
| Electron Fuses (#19): `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`, `EnableCookieEncryption` | ✅ | `build/afterPack.js` |
| Window-state clamp (off-screen-restore bug) | ✅ | `electron/main.js` — `loadWindowState()` |
| Custom `app://` scheme replacing `file://` in prod | ✅ | `electron/main.js` — `registerAppProtocol()` |
| Strict prod CSP (script side) | ✅ | `electron/main.js` — `buildContentSecurityPolicy()` |
| macOS hardened runtime + `allow-jit` entitlement | ✅ | `electron/entitlements.mac.plist` |
| Developer ID signing + notarization + ticket stapling | ✅ | `electron-builder.yml` + `electron-build.env` |
| Auto-updater via `electron-updater` against GitHub Releases | ✅ | `electron/main.js` + the published release |

### CSP note (subtle but important)

Prod CSP: `script-src 'self' blob:` — **no `unsafe-inline`, no `unsafe-eval`**. That's the security-critical directive and it's locked down.

Prod `style-src 'self' 'unsafe-inline'`. The original plan was a per-load nonce, but **CSP nonces only whitelist `<style>` and `<link>` elements — never inline `style=""` attributes**, which react-native-web sets at runtime. There is no nonce-based way to allow that. `'unsafe-inline'` for styles is unavoidable with this stack; style injection is dramatically lower severity than script injection, and the script side stays strict.

---

## Working release flow

In the project terminal, from `/Users/liamhowe/Documents/sign2sign`:

```bash
source electron-build.env           # loads APPLE_API_* env vars (gitignored file)
npm run electron:build:mac          # exports web → packages → signs → notarizes → staples → DMGs
```

The build produces 5 artifacts in `release/`:
- `Sign2Sign Admin-<version>-arm64.dmg` + `.blockmap`
- `Sign2Sign Admin-<version>.dmg` + `.blockmap`
- `latest-mac.yml` (the auto-updater manifest)

### Publishing a release to GitHub

`gh` CLI is already authenticated as `ApP1eSauc3`. No `GH_TOKEN` env var needed.

```bash
V=1.0.1                              # whatever the next version is
gh release create v$V \
  "release/Sign2Sign Admin-$V-arm64.dmg" \
  "release/Sign2Sign Admin-$V-arm64.dmg.blockmap" \
  "release/Sign2Sign Admin-$V.dmg" \
  "release/Sign2Sign Admin-$V.dmg.blockmap" \
  "release/latest-mac.yml" \
  --title "v$V" --notes "…"
```

As of 2026-05-27 the `mac.artifactName` durable fix is applied in `electron-builder.yml`, so DMG filenames and `latest-mac.yml` already agree — no manual `sed` step needed. The historical gotcha is preserved below as #3 for context.

---

## Notarization credentials

**Method:** App Store Connect API key (not Apple-ID + app-specific-password — that path is forgotten-password-fragile and 2FA-friction-heavy).

**File:** `electron-build.env` (gitignored, project root):
```bash
export APPLE_API_KEY="$HOME/private_keys/AuthKey_AW999UQRQC.p8"
export APPLE_API_KEY_ID="AW999UQRQC"
export APPLE_API_ISSUER="5dc883c0-747d-4915-b6aa-641c2f813e0e"
```

The `.p8` key file is gitignored via `*.p8`. Apple lets you download it **only once** — if lost, generate a new key in App Store Connect → Users and Access → Integrations.

**Pre-flight credential check (5s, before sinking 15 min on a build):**
```bash
source electron-build.env
xcrun notarytool history --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER"
```
"No submission history" or a real list = auth OK. HTTP 401 = wrong creds.

---

## Signing identity

- **Cert:** `Developer ID Application: liam howe (8X4733B3NF)`
- **Team ID:** `8X4733B3NF`
- **Cert SHA-1:** `9FC01E63134A568B049D010EA9B117704DF7A7D3`
- **Partition list:** `codesign` has durable ACL access:
  ```bash
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db
  ```
  This was applied once and stops codesign from prompting per-binary. If a future build starts failing with `Above command failed, retrying 3 more times` and **no visible prompt**, re-run this command.

> The keychain also contains an earlier *revoked* "Apple Development" cert. electron-builder ignores it because it filters for `Developer ID Application` on distribution builds. Don't delete it without confirming nothing else depends on it.

---

## Gotchas — read before the next release

These are the non-obvious traps that cost real time to find. Saving them here so they don't bite twice.

### 1. Never name a build config file `.env.<anything>.local`

Expo's env loader globs that pattern and feeds the file to Babel as JavaScript. Shell syntax (`# comment`, `export FOO=bar`) is invalid JS, so Metro's transformer fails and `expo start --web` serves an error blob in place of every bundle. The dev server shows a blank screen with no obvious cause.

Our notarization env file is named `electron-build.env` for exactly this reason. **Anything with a `.env.` prefix is owned by the framework's env loader.**

### 2. react-native-maps cannot enter the web bundle

`react-native-maps` has no web entry — it calls `codegenNativeComponent` at import time, which doesn't exist in the web/Electron bundle. The instant any code path imports it, the renderer throws and React never mounts → blank window.

The crash propagates even when the screen is unreachable on desktop, because **`DriverStack.tsx` imports `DriverMapScreen` statically**, dragging the module in.

**Fix in place:** `src/screens/driver/DriverMapScreen.web.tsx` is a stub. Metro resolves `.web.tsx` ahead of `.tsx` for the web platform, so the real map (and `react-native-maps`) is excluded from the desktop bundle entirely. Driver flow is mobile-only by design.

**For future native-only dependencies:** apply the same `.web.tsx` split for any screen reachable from the navigator's static import graph.

### 3. `latest-mac.yml` filename mismatch — RESOLVED 2026-05-27

**Status:** durable fix applied in `electron-builder.yml` (`mac.artifactName: Sign2Sign-Admin-${version}-${arch}.${ext}`). DMGs now ship hyphenated, GitHub leaves the names alone, YAML / asset / file all agree. No manual step on release.

**Historical context (kept for posterity):** electron-builder used to write the YAML with hyphens (`Sign2Sign-Admin-1.0.0.dmg`) while the DMG shipped with a space (`Sign2Sign Admin-1.0.0.dmg`), which GitHub sanitized to a dot (`Sign2Sign.Admin-1.0.0.dmg`). Three conventions, none agreeing → auto-updater 404. The pre-fix manual workaround was:
```bash
sed -i.bak 's/Sign2Sign-Admin-/Sign2Sign.Admin-/g' release/latest-mac.yml
```
If you ever revert `mac.artifactName`, re-introduce this step.

### 4. Apple Development certs cannot be notarized

Only "Developer ID Application" works for distribution + notarization. An earlier revoked Apple Development cert caused an infinite codesign-retry loop on the very first build attempt because electron-builder fell back to it. If `find-identity` ever shows the right cert is missing or revoked, regenerate via Xcode → Settings → Accounts → Manage Certificates.

### 5. A broken build can poison `release/`

If a build is Ctrl+C'd or crashes mid-sign, `release/mac/` ends up with unsigned helpers. The next build's outer-app codesign then fails with `code object is not signed at all` (codesign refuses outer bundles when subcomponents aren't signed). Cure:
```bash
rm -rf release/
```
…then rebuild clean.

### 6. Auto-updater logs `No published versions on GitHub` until you publish

This is benign — `electron-updater` checks GitHub Releases on startup and logs the empty result. Once v1.0.0 was published the message stopped. Don't chase it before there's anything to update from.

---

## Deferred — not blocking, do when convenient

- ~~**`mac.artifactName` config fix** (gotcha #3)~~ — **DONE 2026-05-27.**
- **Publish via electron-builder** — currently we use `gh release create` manually. `electron-builder build --mac --publish always` with `GH_TOKEN` in the environment does it end-to-end. Marginal; the manual flow is fine and gives more control.
- **Windows build (NSIS)** — `electron-builder.yml` is configured but no Windows code-signing cert exists yet, so it'd ship unsigned and trigger SmartScreen. Defer until there's a Windows admin user.

---

## File map

| Path | Purpose |
|---|---|
| `electron/main.js` | The shell. IPC handlers + sender validation, `app://` protocol handler, CSP, window-state clamp, single-instance lock, OAuth protocol routing, auto-updater wiring. |
| `electron/preload.js` | `contextBridge` API for the renderer (`openExternal`, `secureStorage`, `onOAuthCallback`, `platform`). |
| `electron/entitlements.mac.plist` | Hardened-runtime entitlements (`allow-jit`). Comment inside notes the rollback to `allow-unsigned-executable-memory` if a notarized build ever fails to launch. |
| `build/afterPack.js` | Flips four Electron Fuses on the packaged binary, before electron-builder re-signs. |
| `electron-builder.yml` | Build / sign / notarize / publish config. |
| `electron-build.env` | **Gitignored.** API-key notarization creds. |
| `~/private_keys/AuthKey_*.p8` | **Gitignored** (`*.p8`). App Store Connect API key. Apple allows one download only. |
| `src/screens/driver/DriverMapScreen.web.tsx` | Web stub. Keeps `react-native-maps` out of the desktop bundle. |
| `release/` | Build output. Not committed. Wipe if a build leaves it in a bad state. |

---

## Implementation history (original tasks — all complete)

The original handover sheet (this file's prior form) was a tasking doc for Haiku covering three security-checklist items:

1. **Task 1** — IPC `validateSender` (#17). Implemented in `electron/main.js`. Updated post-`app://` migration to compare against `app://bundle` origin in prod (vs the original `file:` check).
2. **Task 3** — `loadWindowState` off-screen clamp. Implemented in `electron/main.js`.
3. **Task 2** — Electron Fuses (#19) via `build/afterPack.js`. Four fuses flipped: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments` all disabled; `EnableCookieEncryption` enabled.

The "OUT OF SCOPE" items deferred from that pass were subsequently implemented by Opus and shipped in v1.0.0:

1. **Custom `app://` protocol** replacing `file://` — done.
2. **Tight CSP** — done (with the styles caveat documented above).
3. **`allow-jit` entitlement** — done.
4. **Notarization + auto-updater wiring** — done; v1.0.0 is the proof.
5. **Additional fuses** — left at four; broader fuses (`OnlyLoadAppFromAsar`, asar integrity) require further build-system work and remain genuinely out of scope.

The detailed FIND/REPLACE blocks from the original tasking sheet are no longer applicable — `electron/main.js` has been substantially rewritten. See git history (`git log -p electron/main.js`) for the full evolution.
