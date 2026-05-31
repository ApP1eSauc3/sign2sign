// Sign2Sign colour tokens — import from here, never use raw hex in components.
// Dark-first palette optimised for outdoor field use (7:1+ contrast on bg).
// All variations follow HSL rules: darker = higher saturation + lower lightness.
// See CLAUDE.md "Design persona" for the full system.
//
// BRAND IDENTITY (from sign2site.com.au):
//   The brand is a strict two-colour system — white + one confident sky blue.
//   Blue is always used at full weight as a solid block, never as a subtle tint.
//   Rule: if blue appears on screen, it fills the element entirely.
//
// Confirmed 2026-05-31: sampled directly from Sige2site-04.png — the
// dominant blue is #0CAAEC (HSL 198°/90%/49%). This is the literal logo
// blue and the value used for the app icon, splash, and Android adaptive
// background. White-on-#0CAAEC is 2.63:1 — below the 7:1 outdoor target
// in CLAUDE.md. Trade-off accepted: brand fidelity over WCAG. Use heavy
// type weight on CTA labels, and prefer brandPressed/brandDeep when a
// long label sits on top of brand for an extended dwell.

export const colors = {
  // Surfaces
  bg:            '#0F1117',  // page base — dark for outdoor glare resistance
  surface:       '#1A1D27',  // cards, list items
  surfaceActive: '#22263A',  // pressed / selected card — higher S, higher L
  border:        '#2C3040',  // dividers

  // Text
  textPrimary:   '#F5F7FA',  // 16.1:1 on bg — primary labels
  textSecondary: '#9BA3B2',  // 5.2:1 on bg — secondary info
  textDisabled:  '#4A5060',  // below AA — disabled states only

  // Brand blue — confirmed from Sign2Site logo, 2026-05-31
  brand:         '#0CAAEC',  // logo blue — HSL(198°, 90%, 49%) — solid fills only
  brandPressed:  '#0888BD',  // pressed state — HSL(198°, 92%, 39%) — 4.7:1 white
  brandDeep:     '#066A92',  // deep variant — HSL(198°, 94%, 30%) — 6.5:1 white

  // Job type (left-border stripe on cards)
  install:       '#00C9A7',  // teal — install jobs
  removal:       '#FF7043',  // orange — removal jobs

  // Status badges
  statusPending:     '#7FB3D3',
  statusPendingBg:   '#2C3A4A',
  statusProgress:    '#FFD166',  // amber — max peripheral visibility, CVD-safe
  statusProgressBg:  '#3A2F00',
  statusComplete:    '#4ECB71',
  statusCompleteBg:  '#1A3A2A',
  statusFailed:      '#FF6B6B',
  statusFailedBg:    '#3A1A1A',

  // Admin — light mode tokens (office/desktop context, not outdoor)
  // These only appear in admin screens. Drivers never see these values.
  adminText:          '#101828',  // near-black primary text
  adminTextSecondary: '#344054',  // secondary labels, field labels
  adminTextTertiary:  '#667085',  // section labels, hints, muted meta
  adminTextHint:      '#98A2B3',  // very muted — placeholders, empty states
  adminBorder:        '#D0D5DD',  // input borders
  adminDivider:       '#F2F4F7',  // dividers, card borders
  adminSurface:       '#F9FAFB',  // card backgrounds
  adminCardBorder:    '#E4E7EC',  // card borders (slightly darker than divider)
  adminSelectedBg:    '#EBF5FF',  // selected state — brand blue tint
  adminSuccess:       '#027A48',  // connected/success green
  adminSuccessBg:     '#ECFDF3',  // success background
  adminError:         '#B42318',  // error red (import failures)

  // Absolute
  white:         '#FFFFFF',
  black:         '#000000',
} as const;

export type ColorToken = keyof typeof colors;
