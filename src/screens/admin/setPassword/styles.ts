// Styles for SetPasswordScreen. Deliberately mirrors AdminLoginScreen's brand
// header + white form composition — this screen is reached from that one, and
// a matching frame is what tells the user they have not left the login flow.
import { StyleSheet } from 'react-native';
import { colors } from '../../../utils/colors';

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },

  // Brand header — blue fills the block entirely (brand identity rule)
  header: {
    backgroundColor: colors.brand,
    paddingHorizontal: 32,
    paddingBottom: 40,
    alignItems: 'flex-start',
  },
  wordmark: { fontSize: 48, fontWeight: '800', color: colors.white, letterSpacing: -1 },
  wordmarkSub: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: 3,
    opacity: 0.8,
    marginTop: -4,
  },

  formScroll: { flex: 1, backgroundColor: colors.white },
  form: { paddingHorizontal: 32, paddingTop: 36 },  // DESIGN §1.3
  formTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.adminText,
    marginBottom: 8,
  },
  formIntro: {
    fontSize: 14,
    color: colors.adminTextSecondary,
    lineHeight: 20,
    marginBottom: 24,  // DESIGN §1.3 — on-grid
  },

  // Neutral confirmation after a code is requested. Success-green would be a
  // claim we cannot make: the request is deliberately answered the same way
  // whether or not the address has an account (see AuthService).
  noticeBox: {
    backgroundColor: colors.adminSelectedBg,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: { color: colors.adminTextSecondary, fontSize: 14, lineHeight: 20 },

  // Outlined, not filled. There is no `adminErrorBg` token and colors.ts is
  // Collaborative (a new token needs flagging first), so this reuses the
  // established admin danger treatment from AccountScreen's dangerCard:
  // white ground, adminError border, adminError text. 8.2:1 on white.
  //
  // NOTE: AdminLoginScreen's own error box uses statusFailedBg/statusFailed,
  // which are the *driver* dark-mode tokens, on a white admin screen. That is
  // a pre-existing inconsistency, not a pattern to copy — flagged, not changed.
  errorBox: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.adminError,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: colors.adminError, fontSize: 15, fontWeight: '500' },

  button: { marginTop: 4 },

  // Secondary actions — text links, never competing with the single CTA
  linkButton: { alignSelf: 'center', marginTop: 24 },
  linkText: { color: colors.adminTextTertiary, fontSize: 14 },
});
