# Sign2Sign — Screens Layer

This file loads automatically for any file under `src/screens/`. Screens are React Native UI components. They may import from stores, services, data, and utils. They never call Supabase directly.

> You are a senior React Native product designer who has shipped field-operations tooling used by thousands of tradespeople and delivery crews. Every screen here will be used outdoors, in sunlight, with gloved hands, by people who glance at the screen for under two seconds. Hierarchy must be instantly obvious. The next action must never require thought. Adopt the full design persona from the root `CLAUDE.md` before writing a single line of JSX.

This document is the **single source of truth** for every dimension, colour, spacing value, and motion parameter in the app. If a value is not in this document, it does not go into a screen.

```
§ 1  Design Tokens       — colour, spacing grid, typography, radius, opacity, elevation
§ 2  Layout System       — device targets, safe areas, proportions, thumb zones
§ 3  Component Specs     — advancing action button, job card, status badge, left stripe
§ 4  Motion & Haptics    — minimal motion, haptic triggers
§ 5  Screen Blueprints   — zone maps for driver and admin screens
§ 6  Guardrails          — what this app is NOT + non-negotiables
```

All tuneable design values in screen files are annotated `// DESIGN §X.X — description`. Search `// DESIGN` in any screen file to find every value you can change.

---

## Layer rule — never call Supabase from a screen

All Supabase reads and writes must go through a `services/` file. Calling `supabase` directly in a screen is a layer violation.

```typescript
// ✅ — delegate to a service via a store action
const loadSession = useDriverSession((s) => s.loadSession);
useEffect(() => { loadSession(code); }, [code]);

// ❌ — direct Supabase call in a screen
import { supabase } from '../services/supabaseClient';
const { data } = await supabase.from('jobs').select('*');
```

---

## Import rules

```typescript
// ✅
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../utils/colors';
import { useDriverSession } from '../stores/useDriverSession';
import { SignJob } from '../data/SignJob';

// ❌ — never call Supabase from a screen
import { supabase } from '../services/supabaseClient';
```

---

## § 1 — Design Tokens

### 1.1 Colour tokens — always use these, never raw hex

Import from `src/utils/colors.ts`. Never use raw hex in a StyleSheet.

```typescript
// ✅
import { colors } from '../utils/colors';
backgroundColor: colors.brand

// ❌ — raw hex in a component
backgroundColor: '#147EC4'
```

**Quick reference — key tokens:**

| Token | Value | Usage |
|---|---|---|
| `colors.bg` | `#0F1117` | Driver screen base — absorbs outdoor glare |
| `colors.surface` | `#1A1D27` | Cards, list items |
| `colors.surfaceActive` | `#22263A` | Pressed / selected — HSL variation, not opacity |
| `colors.brand` | `#147EC4` | Solid fill only — buttons, active nav |
| `colors.brandPressed` | `#0F66A8` | Pressed state — higher S, lower L |
| `colors.textPrimary` | `#F5F7FA` | 16:1 on bg — primary labels |
| `colors.textSecondary` | `#9BA3B2` | 5.2:1 on bg — secondary info |
| `colors.install` | `#00C9A7` | Install job left stripe |
| `colors.removal` | `#FF7043` | Removal job left stripe |
| `colors.statusComplete` | `#4ECB71` | Mark Complete enabled state |
| `colors.statusFailed` | `#FF6B6B` | Retry Photo state |
| `colors.white` | `#FFFFFF` | Admin backgrounds, button text on brand |

### 1.2 HSL variation rules *(learnui.design)*

This is the single most important colour rule in the system.

- **Darker / pressed variant** → higher saturation + lower lightness. `brandPressed` is `brand` with S raised, L lowered.
- **Never** darken by adding opacity to the base colour — it changes alpha, not HSL, looks flat.

```typescript
// ✅ — pressed state is an HSL variation, not opacity
backgroundColor: pressed ? colors.brandPressed : colors.brand,

// ❌ — opacity overlay loses saturation, looks washed out
opacity: 0.8,
backgroundColor: colors.brand,
```

### 1.3 Spacing grid — 8pt base, no arbitrary values

Only these values are permitted. Arbitrary values (14, 18, 22, 26, 34) are the most common source of visual inconsistency in the app.

| Value (pt) | Common usage |
|---|---|
| `4` | Icon-to-label gap, tight badge padding |
| `8` | Row internal padding, caption insets |
| `12` | Compact card inner padding, left stripe width, card-to-card gap |
| **`16`** | **Standard horizontal page margin, card inner padding** |
| `20` | Inset list padding |
| **`24`** | **Section-to-section gap, header bottom padding** |
| `32` | Large section gap |
| `40` | Screen top breathing room |
| `48` | Hero / header zone top padding |
| `64` | Gloved-hand CTA minimum height |

```typescript
// ✅ — on-grid
paddingHorizontal: 16,  // DESIGN §1.3 — standard page margin
gap: 24,                // DESIGN §1.3 — section gap
paddingVertical: 8,     // DESIGN §1.3 — row inset

// ❌ — off-grid, breaks visual rhythm
paddingHorizontal: 18,
gap: 22,
```

### 1.4 Text opacity ladder — driver dark mode

Use pre-computed tokens. Never apply raw `opacity` to text to approximate a secondary label.

| Role | Token |
|---|---|
| Primary label | `colors.textPrimary` — 16:1 contrast on bg |
| Secondary label | `colors.textSecondary` — 5.2:1 |
| Disabled / ghost | `colors.textDisabled` — disabled states only, never readable content |
| White on brand blue | `colors.white` |

Anything below `textSecondary` contrast disappears in direct sunlight.

### 1.5 Surface elevation — driver dark mode

| Level | Token | Notes |
|---|---|---|
| Base screen | `colors.bg` | Darkest surface — page background |
| Lifted card | `colors.surface` | Standard list items |
| Interactive card (pressed) | `colors.surfaceActive` | On press — HSL lighter, not opacity lighter |
| Primary CTA | `colors.brand` (solid) | Never semi-transparent |
| Disabled CTA | `colors.surfaceActive` fill + `colors.textDisabled` text | Never just `opacity: 0.5` |

### 1.6 Corner radii

| Component | Radius |
|---|---|
| Screen-level modal / bottom sheet | `16` (top corners only) |
| Standard card / job card | `10` |
| Status badge / pill | `99` (capsule) |
| Input field | `8` |
| Icon container | `8` |
| Full-bleed element | `0` |

### 1.7 Typography scale

| Role | `fontSize` | `fontWeight` | Notes |
|---|---|---|---|
| Screen title | `24` | `'700'` | Driver screen headers |
| Section header | `18` | `'600'` | Card section titles |
| Row primary | `17` | `'600'` | Address line 1 |
| Row secondary | `15` | `'400'` | Address line 2 |
| Meta / caption | `13` | `'400'` | Client, agent, timestamps |
| Badge / micro | `11` | `'600'` | Status pill text — never tappable at this size |

Minimum tappable text size: `13pt`. Never make `11pt` text interactive.

### 1.8 Button specs

- **Primary action** — `colors.brand` fill, `colors.white` text, `minHeight: 56`
- **Advancing CTA** (Take Photo / Mark Complete) — `colors.brand` fill, `minHeight: 64` (gloved hands)
- **Destructive** — `colors.statusFailed` fill, `colors.white` text
- **Disabled** — `colors.surfaceActive` fill + `colors.textDisabled` text. Never `opacity: 0.5` on the enabled style.
- **Admin primary** — `colors.brand` fill, `colors.white` text, `minHeight: 48` (office context, bare fingers)

---

## § 2 — Layout System

### 2.1 Device targets

Design to iPhone 14 (390×844pt) as the baseline. iPhone SE 3rd gen (375×667pt) is the minimum iOS target.

| Device | Width (pt) | Notes |
|---|---|---|
| iPhone SE 3rd gen | 375 | Minimum — no home indicator, `insets.bottom = 0` |
| iPhone 14 / 15 | 390 | Baseline |
| iPhone 14 Plus / Pro Max | 430 | Wider — test that lists don't look sparse |
| Android (median) | 360–412 | Flexbox handles it |

### 2.2 Safe areas — always use `useSafeAreaInsets`

```typescript
// ✅
const insets = useSafeAreaInsets();
paddingTop: insets.top + 16,     // DESIGN §2.2 — safe top + standard margin
paddingBottom: insets.bottom + 16, // DESIGN §2.2 — safe bottom + standard margin

// ❌ — clips content on notched devices
paddingTop: 16,
```

### 2.3 Thumb zone map (iPhone 14, portrait, right-hand grip)

This app is used with one hand. Primary actions belong where thumbs naturally reach.

```
┌─────────────────────────┐  0pt   — top of screen
│  ░░░ HARD REACH ░░░░░░  │
│  ░░ top 25% ░░░░░░░░░░  │  0–210pt    avoid primary actions
│─────────────────────────│  210pt
│                         │
│   COMFORTABLE REACH     │  210–560pt  secondary actions, content
│      middle 40%         │
│                         │
│─────────────────────────│  560pt
│                         │
│   NATURAL THUMB ZONE    │  560–760pt  ← PRIMARY ACTIONS HERE
│      lower 24%          │
│                         │
│─────────────────────────│  760pt
│  ████ BOTTOM SAFE ████  │  760–844pt
└─────────────────────────┘  844pt
```

**CTAs, "Take Photo", "Mark Complete", and mode toggles must live in the lower third.**

```typescript
// ✅ — pinned CTA in thumb zone
position: 'absolute',
bottom: insets.bottom + 16,  // DESIGN §2.3 — thumb zone CTA
left: 16,
right: 16,
```

### 2.4 Horizontal margins

| Context | Value |
|---|---|
| Page-level horizontal padding | `16` |
| Card inner padding | `16` |
| Card-to-card gap | `12` |
| Full-bleed element | `0` — set `marginHorizontal: 0` explicitly |

---

## § 3 — Component Specs

### 3.1 Advancing action button

One large button at the bottom of the driver job detail screen. Label and background change with upload state — the crew never decides what to do next.

| Upload state | Label | Background | Enabled |
|---|---|---|---|
| `idle` | `Take Photo` | `colors.brand` | ✅ |
| `capturing` | `Opening Camera…` | `colors.brandPressed` | ❌ |
| `preview` | `Upload Photo` | `colors.brand` | ✅ |
| `uploading` | `Uploading…` | `colors.brandPressed` | ❌ |
| `succeeded` | `Mark Complete` | `colors.statusComplete` | ✅ |
| `failed` | `Retry Photo` | `colors.statusFailed` | ✅ |

```typescript
// ✅ — reads boolean from store, zero logic in the component
const enabled = useDriverSession((s) => s.canMarkComplete(jobId));
<TouchableOpacity disabled={!enabled} style={{ minHeight: 64 }} />  // DESIGN §3.1

// ❌ — logic leaking into the screen
const state = useDriverSession((s) => s.uploadStates[jobId]);
const enabled = state?.status === 'succeeded';
```

### 3.2 Job card structure

```
┌─ 4pt left stripe  (install: colors.install / removal: colors.removal)
│
│  [STATUS BADGE]              [INSTALL / REMOVAL pill]      minHeight: 64
│
│  123 Maple Street            ← fontSize:17, fontWeight:'600', textPrimary
│  Unit 4B                     ← fontSize:15, fontWeight:'400', textSecondary
│
│  Client: Harcourts  ·  Agent: J. Smith  ← fontSize:13, textSecondary
│
│  [Photo ✓]  or  [Photo needed]          ← upload state shown on card
└────────────────────────────────────────────────────
```

Card: `colors.surface` background, `borderRadius: 10`, `minHeight: 64`. Left stripe: `width: 4`, `borderTopLeftRadius: 10, borderBottomLeftRadius: 10`.

### 3.3 Status badge

Pill shape (`borderRadius: 99`). Text at `fontSize: 11, fontWeight: '600'`. Always paired as foreground + background:

| State | Text token | Background token |
|---|---|---|
| Pending | `colors.statusPending` | `colors.statusPendingBg` |
| In Progress | `colors.statusProgress` | `colors.statusProgressBg` |
| Complete | `colors.statusComplete` | `colors.statusCompleteBg` |
| Failed | `colors.statusFailed` | `colors.statusFailedBg` |

### 3.4 Touch targets — non-negotiable

*(Parhi et al., 2006: error rate minimised at 56pt bare fingers, 64pt gloved.)*

| Component | `minHeight` | Notes |
|---|---|---|
| Standard list item / job card | `64` | Primary field interaction |
| Standard button | `56` | Bare-finger minimum |
| Take Photo, Mark Complete | `64` | Gloved-hand minimum |
| Icon-only button | `44` visual + `hitSlop` | `hitSlop={{ top:12, bottom:12, left:12, right:12 }}` |

---

## § 4 — Motion & Haptics

### Motion — minimal, purposeful

This is a field tool, not a consumer product. Every transition should complete in under 250ms.

| Use case | Pattern |
|---|---|
| Screen transition | React Navigation default (native stack feel) |
| Button state change (label/colour) | Instant — no animation, reads as responsive |
| Loading state | `ActivityIndicator` only — no custom spinners |
| Modal / bottom sheet | React Navigation `modal` presentation |

Never add decorative animations. If it doesn't confirm an action or indicate progress, it doesn't belong.

### Haptics — primary feedback channel on-site

Audio is unreliable outdoors. Haptics are the primary confirmation signal.

```typescript
import * as Haptics from 'expo-haptics';

// Primary CTA (Take Photo, Mark Complete)
await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);  // DESIGN §4

// Success confirmation (upload succeeded)
await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

// Error / failure
await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

// Destructive warning
await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
```

Add haptic feedback to: photo capture start, upload success, upload failure, mark complete confirmation.

---

## § 5 — Screen Blueprints

### Driver route list (dark mode)

```
┌──────────────────────────────────┐
│  [insets.top + 16]               │ ← safe area
│  Screen title  24pt '700'        │  header zone
│  [24pt gap]                      │
├──────────────────────────────────┤
│  FlatList — job cards            │  content zone, flex: 1
│    card minHeight: 64            │
│    paddingHorizontal: 16         │
│    ItemSeparatorComponent: 12    │
├──────────────────────────────────┤
│  [insets.bottom + 16]            │ ← safe area
└──────────────────────────────────┘
```

### Driver job detail (dark mode)

```
┌──────────────────────────────────┐
│  [Header — back button + address]│
│  [Job metadata card, padding 16] │
│  [Photo preview, if captured]    │
│  [Status row]                    │
├──────────────────────────────────┤
│  ScrollView — flex: 1            │
├──────────────────────────────────┤
│  [Advancing action button]       │  position: absolute
│   minHeight: 64                  │  bottom: insets.bottom + 16
│   left: 16, right: 16            │
└──────────────────────────────────┘
```

### Admin screens (light mode)

Background: `colors.white`. Primary text: `colors.adminText`. Cards: `colors.adminSurface` with `colors.adminCardBorder` border. Designed for desktop/office — no outdoor contrast constraints. Use `colors.brand` as solid fill for CTAs only.

---

## § 6 — Guardrails

### What this app is NOT

- Not a consumer app — no hero imagery, no gradients, no decorative colour
- Not a social feed — no infinite card stacks without a destination
- Not over-animated — motion serves confirmation, not personality
- Not brutalist dark — darkness is a contrast aid, not an aesthetic statement

### Apple / Android HIG non-negotiables

- Touch target minimum: `minHeight: 64` for primary CTA, `minHeight: 56` for standard buttons
- Safe areas: always `useSafeAreaInsets` — never hardcode top/bottom padding
- `KeyboardAvoidingView` on every screen with text inputs:

```typescript
// ✅
<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  style={{ flex: 1 }}
>

// ❌ — keyboard covers inputs on iOS
<View style={{ flex: 1 }}>
```

- Contrast: outdoor minimum is WCAG AAA (7:1). `textPrimary` on `bg` achieves 16:1.
- Advancing action button: one per screen, store-driven, never navigates, never contains logic.

---

## `navigation.replace` vs `navigation.navigate` after auth

```typescript
// ✅ — replace removes login from the stack; back button won't return to the form
navigation.replace('AdminDashboard');

// ❌ — navigate keeps login in stack
navigation.navigate('AdminDashboard');
```

---

## What to avoid

- Raw hex — always `colors.*`
- Off-grid spacing — only values from §1.3
- `canMarkComplete` logic in a screen — read the bool from the store
- Direct Supabase calls — always go through a service
- Business logic in JSX — extract to store or service
- Hardcoded padding without `useSafeAreaInsets`
- Decorative animation
- Disabled state via `opacity: 0.5` — use the correct disabled tokens
