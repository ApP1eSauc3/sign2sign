# Sign2Sign — Apple Submission Audit, 2026-06-02

Companion to `docs/SECURITY_AUDIT_2026_06_01.md`. Sourced from a
research-agent audit on 2026-06-02 against current (2026) App Store
Review Guidelines, HIG, and iOS submission requirements. Each finding
is verified against the repo, then either applied in code or tracked
here.

## Status snapshot

| ID | Title | Sev | Status |
|---|---|---|---|
| A1 | `ITSAppUsesNonExemptEncryption` not declared | Blocker | ✅ closed |
| A2 | Stale `NSLocationAlways*` purpose strings in Info.plist | High | ✅ closed |
| A3 | Stale `NSFaceIDUsageDescription` | Medium | ✅ closed |
| A4 | Android `RECORD_AUDIO` permission unused | Info | ✅ closed |
| A5 | `NSPrivacyCollectedDataTypes` empty | Medium | ✅ closed |
| A6 | Sign in with Apple obligation | Info | Not required — note in App Review Notes |
| A7 | App Tracking Transparency | Info | Not required |
| A8 | Sharpen location purpose string | Low | ✅ closed |
| A9 | Account-deletion microcopy | Low | ✅ closed |
| A10 | Brand contrast `#0CAAEC` on white = 2.63:1 | Medium | Open — accepted trade-off (see [[Brand token decision]]); revisit if Apple flags |
| A11 | Dynamic Type / accessibility labels | Medium | Partial — added on AccountScreen back button; broader sweep pending |
| A12 | iPad support decision | High | ✅ closed — `supportsTablet: false` |
| A13 | App Store Connect metadata + screenshots | High | Open — needs human design + ASC submission |
| A14 | Driver codeless reviewer notes | Low | Open — pre-write before submission |
| A15 | Expo SDK 55 archive smoke test | Low | Open — do before submission |
| A16 | Optional Terms of Service | Low | Deferred |

## What changed in the repo this pass

**`app.json` is the single source of truth.** The `ios/` directory is
gitignored — `npx expo prebuild` regenerates `Info.plist` and
`PrivacyInfo.xcprivacy` from `app.json` on every build. Driving the
config from `app.json` ensures the next prebuild does NOT reintroduce
the placeholder permission strings that the audit flagged.

What changed in `app.json`:
- `expo-image-picker` plugin configured with `cameraPermission` set to
  our specific string, `photosPermission: false`, `microphonePermission: false`
  — so prebuild only emits `NSCameraUsageDescription`, never the
  microphone or photo-library purpose strings.
- `expo-location` plugin configured with `locationWhenInUsePermission`
  set to the sharpened string from A8, both `locationAlways*` set to
  `false`, and `isAndroidBackgroundLocationEnabled: false` — so
  prebuild only emits `NSLocationWhenInUseUsageDescription`, no Always
  variants.
- `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` — closes A1.
- `ios.supportsTablet: false` — closes A12.
- `ios.privacyManifests` block carries the full Apple privacy manifest:
  the four `NSPrivacyAccessedAPITypes` Expo SDK 55 needs, plus the five
  `NSPrivacyCollectedDataTypes` entries that mirror the App Privacy
  questionnaire inventory at `docs/APP_PRIVACY_LABELS.md` (email, photos,
  precise location, user ID, device ID; all App Functionality; linked
  except device ID; none tracking; `NSPrivacyTracking: false`).
- `android.permissions` `RECORD_AUDIO` removed.

The `ios/sign2sign/Info.plist` and `PrivacyInfo.xcprivacy` files were
also edited directly as a local sanity check — they reflect what the
next prebuild should produce. They are gitignored and will be
regenerated, which is fine since `app.json` now produces the same.

**`src/screens/admin/AccountScreen.tsx`** — danger copy rewritten:
explicitly says the admin's email + password is deleted from the
auth system and explicitly says photos/jobs/routes belong to the
operating entity and are retained. Confirm-step microcopy fixed from
the confusing "tapping the button twice" wording (it described two
different buttons) to the literal next action ("Tap 'Delete forever'
to confirm"). Back chevron got `accessibilityRole` + `accessibilityLabel`
so VoiceOver doesn't read "less-than sign".

## Things to do before submission (the punch list that's left)

- [ ] **A13 — ASC metadata + screenshots.** Capture iPhone screenshots
      at the size ASC requires at upload time (changes per iPhone
      generation — verify in ASC). Write description (<4000 char),
      promotional text (<170 char), keywords (<100 char), pick primary
      category (suggested: Business), prepare reviewer demo admin
      login + an active 6-digit driver code.
- [ ] **A14 — App Review Notes.** Pre-write text explaining:
      (1) drivers don't have accounts; they enter a daily-rotating
      6-digit code given by the dispatcher;
      (2) Google OAuth is *not* a login — it authorises a single Google
      Sheet for the import flow only.
- [ ] **A15 — Production-archive smoke.** One real-device archive via
      Xcode (or `eas build --profile production`). Cold-start time,
      no `__DEV__`-only code, Hermes/JSC choice matches your perf
      testing.
- [ ] **A11 (continued) — Accessibility sweep.** Currently only the
      AccountScreen back chevron has labels. Add `accessibilityLabel`s
      to the `›` route chevrons in `AdminDashboardScreen.tsx` and
      `AdminRouteDetailScreen.tsx`, the `−`/`+` stepper buttons, the
      code-selection cards. Run iOS simulator with VoiceOver before
      submission.
- [ ] **A10 — Contrast re-decision (optional).** Current brand fill
      `#0CAAEC` + white text = 2.63:1, accepted as a brand-fidelity
      trade-off (logged in `src/utils/colors.ts`). If you want to
      pre-empt an Apple accessibility flag, bump CTA labels to 17pt
      bold (large-text 3:1 bar is easier) or swap CTAs to
      `colors.brandDeep` (#066A92, 6.5:1).

## What's confirmed compliant (no action)

- Privacy manifest format matches Apple's spring-2024 schema.
- `NSPrivacyTracking=false` aligned with no analytics/ads SDKs.
- In-app account deletion meets Guideline 5.1.1(v).
- Privacy policy is live and reachable without authentication.
- No Sign in with Apple obligation (Google OAuth is a data connector,
  not a login).
- No App Tracking Transparency obligation.
- `NSAppTransportSecurity` enforces HTTPS only.
- No In-App Purchase, push, background modes — fewer review surfaces.
- Driver codeless flow has no Apple guideline conflict (precedent
  exists for contractor / kiosk patterns).
- Account deletion two-step destructive pattern matches HIG
  destructive-action guidance.

## Notes on uncertainty (be careful)

- ASC screenshot size requirements change per iPhone generation.
  Verify the exact pixel size in App Store Connect at the moment of
  upload — do not trust this document.
- Guideline 4.8 (Sign in with Apple) wording has been edited several
  times. The current carve-out for "third-party APIs used for purposes
  other than login" covers Sign2Sign's Google Sheets usage, but
  re-read 4.8 immediately before submission.
- Expo SDK 55 + RN 0.83 + RCTNewArchEnabled is leading-edge — issues
  filed against expo/expo near the time of submission may flag a
  late-breaking gotcha. Check before archive.
