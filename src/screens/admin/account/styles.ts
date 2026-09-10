// Styles for AccountScreen, split out to keep the screen under the 300-line
// cap (scripts/check-lines.js). Screen-specific, so it lives in a sibling
// folder named after the screen rather than in components/ — DESIGN §3.5.
import { StyleSheet } from 'react-native';
import { colors } from '../../../utils/colors';

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,  // DESIGN §1.3 — standard page margin
    paddingVertical: 12,
  },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 24 },  // DESIGN §1.3

  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.adminTextTertiary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  emailValue: { fontSize: 16, fontWeight: '600', color: colors.adminText },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  linkLabel: { fontSize: 15, color: colors.adminText, fontWeight: '500' },
  linkChevron: { fontSize: 18, color: colors.adminTextTertiary, fontWeight: '400' },

  inviteTitle: {
    fontSize: 17,  // DESIGN §1.7 — row primary
    fontWeight: '700',
    color: colors.adminText,
    marginBottom: 8,
  },
  inviteBody: {
    fontSize: 14,
    color: colors.adminTextSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  inviteNotice: {
    fontSize: 14,
    color: colors.adminSuccess,
    lineHeight: 20,
    marginBottom: 12,
  },

  dangerCard: { borderColor: colors.adminError, backgroundColor: colors.white },
  dangerTitle: {
    fontSize: 17,  // DESIGN §1.7 — row primary
    fontWeight: '700',
    color: colors.adminError,
    marginBottom: 8,
  },
  dangerBody: {
    fontSize: 14,
    color: colors.adminTextSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },

  confirmHint: {
    fontSize: 13,
    color: colors.adminTextSecondary,
    marginBottom: 12,
  },
  confirmRow: { flexDirection: 'row', gap: 12 },
});
