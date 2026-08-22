# Dependency audit triage — 2026-08-21

Closes the triage half of open-work **#8**. Every number here was produced on
2026-08-21 by the command shown above it; per CLAUDE.md → Documentation
Integrity Rules, re-run before trusting any of it after a lockfile change.

**Bottom line:** of 39 advisories, **exactly one chain reaches a shipped
artifact**, and it is fixed by a *patch* bump — not the semver-major upgrade
`npm audit fix` proposes. Everything else is build tooling that runs on a
developer's machine and never executes in the iOS app or the packaged desktop
app.

---

## The numbers

```bash
npm audit --json                # full tree
npm audit --omit=dev --json     # production dependency tree only
```

| Scope | critical | high | moderate | low | total |
|---|---|---|---|---|---|
| Full tree | 2 | 27 | 9 | 1 | **39** |
| Production tree (`--omit=dev`) | 1 | 12 | 9 | 1 | **23** |

The handover's earlier figure of 42 (2 critical, 33 high) is from 2026-08-18 and
has drifted — Dependabot has been landing PRs since. That drift is exactly what
Rule 2 exists to catch.

**"Production tree" is not the same as "ships to a user."** `expo` declares
`metro`, `@expo/metro`, `image-size`, `postcss` and friends as runtime
dependencies, so they appear under `--omit=dev`, but they execute during
`expo export` / Metro bundling on a developer's machine. They are not part of
the JS bundle the phone runs. Read the table below, not the totals.

---

## What actually ships

### 🔴 `electron-updater` → `builder-util-runtime` — the only one that reaches a user

| | |
|---|---|
| **Advisory** | Cross-origin redirect leaks `PRIVATE-TOKEN` and mixed-case `Authorization` credentials in `builder-util-runtime` |
| **Severity** | high |
| **Reaches** | The packaged macOS admin app. `electron-updater` is a direct **`dependencies`** entry and is `require`d at `electron/main.js:524`, guarded by `if (!isDev)` — so it runs in shipped builds only, which is precisely the artifact users have. |
| **Installed** | `electron-updater` 6.8.3 → `builder-util-runtime` 9.2.10 |
| **Fixed in** | `electron-updater` **6.8.9**, which pins `builder-util-runtime` **9.7.0** exactly — the first version outside the advisory's `<9.7.0` range. Verified with `npm view electron-updater@6.8.9 dependencies`. |

**Exploitability in this configuration is low, and that is a reason to schedule
the fix calmly, not to skip it.** The advisory is about leaking a credential on
a redirect. This app's updater checks a **public** GitHub repo
(`electron-builder.yml` → `publish: provider: github, owner: ApP1eSauc3, repo:
sign2sign`) and sends no credential at runtime — `GH_TOKEN` is required when
*publishing* a release, not when checking for one. With no token in the request
there is nothing for a redirect to leak.

That assessment rests on the publish config and on no `GH_TOKEN` being present
in the packaged app's environment. If the repo is ever made private, or a token
is added to the updater config, this moves straight to urgent.

> ### ⚠️ Flagged, not done: bump `electron-updater` `^6.8.3` → `^6.8.9`
>
> A patch bump, but it changes a **shipped, notarized artifact**. It must be
> followed by `npm run electron:build:mac`, re-notarization (Developer ID cert +
> App Store Connect API key — see the `electron-mac-notarization` memory), and a
> launch smoke test on a clean machine. That is Liam's call and Liam's
> credentials, so the bump is not applied here.

### ⚪ `electron-builder` 25.1.8 → 26.15.3 — dev-only, semver-**major**

This is what `npm audit fix` proposes, and it is the reason the fix looks scarier
than it is. `electron-builder` is a **`devDependencies`** entry: it builds the
app, it does not ship inside it. It pulls its own copy of the vulnerable
`builder-util-runtime`, plus `app-builder-lib`, `dmg-builder`, `@electron/rebuild`
and `tar`.

A major upgrade of the packaging toolchain changes how the macOS app is built and
signed. Given none of it executes on a user's machine, **defer it** — and when it
is done, do it on its own branch with a full build + notarize + install test, not
bundled with feature work.

---

## What does not ship

Everything below runs during development or packaging only. Listed so nobody has
to re-derive it next time the CI badge goes red.

| Package | Why it cannot reach a user |
|---|---|
| `metro`, `@expo/metro`, `metro-config`, `metro-transform-worker` | The JS bundler. Runs at build time. |
| `image-size` | Pulled by Metro to size image assets during bundling. |
| `postcss` | CSS processing in the web export pipeline. |
| `ws` | Metro's dev-server websocket. Never in a release bundle. |
| `shell-quote` (**critical**) | Metro/CLI argument escaping on the dev machine. The DoS is against your own terminal. |
| `js-yaml`, `brace-expansion`, `nanoid`, `tmp`, `form-data`, `ip-address`, `extract-zip`, `tar` (**critical**), `cacache`, `node-gyp`, `make-fetch-happen` | Transitive build/packaging utilities. |
| `electron` (dev), `electron-builder`, `app-builder-lib`, `dmg-builder`, `electron-publish`, `builder-util`, `@electron/rebuild` | Packaging toolchain. Note the `electron` *runtime* shipped inside the app is the binary electron-builder downloads, pinned by `electron-builder.yml`, not this dev dependency. |

**Worth one check before trusting the "does not ship" column:** if you want
certainty that none of these entered the web bundle, build it and grep:

```bash
npm run web && grep -rl "nanoid\|shell-quote" dist/ || echo "not bundled"
```

---

## CI policy — a decision, not a bug

`.github/workflows/ci.yml` runs `npm audit --audit-level=high` as a **blocking**
job, deliberately, so the number stays visible. As of today it fails, and it will
keep failing after the `electron-updater` bump, because the Expo toolchain's own
dependency tree carries high-severity advisories that only Expo can fix.

That is the problem worth naming: **a gate that can never go green stops being a
signal.** People learn to scroll past a red badge, and the one time it turns red
for a real reason, nobody looks.

Three options, none of them "ignore it":

1. **Split the job.** Block on `npm audit --omit=dev --audit-level=high`, run the
   full-tree audit with `continue-on-error: true` for visibility. Honest about
   which failures are actionable — but the production job is *also* red today, so
   this does not go green either until Expo's tree improves.
2. **Make the audit informational** (`continue-on-error: true`) with a dated
   comment naming what was triaged and when to re-review. Keeps the number
   visible without training people to ignore a red check.
3. **Leave it blocking.** Accepts a permanently red CI as a deliberate nag.
   Current state.

**Recommendation: (2), with this document as the reference and a re-review date.**
It is the option that keeps the signal honest. Whichever is chosen, record it here
with a date — an undocumented choice here reads as an oversight to the next
person, which is how #8 sat open in the first place.

---

## Re-check command

```bash
npm audit --omit=dev --audit-level=high    # the subset that can affect a user
npm audit                                  # everything, for the record
```
