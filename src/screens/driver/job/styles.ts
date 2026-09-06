import { StyleSheet } from 'react-native';
import { colors } from '../../../utils/colors';

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  typeStripe: {
    height: 4,
    width: '100%',
  },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 24 },  // DESIGN §2.4 — standard page margin

  address: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 34,
    marginBottom: 24,
  },

  detailsCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,         // DESIGN §1.6 — standard card
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    paddingVertical: 12,      // DESIGN §1.3 — on-grid
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: {
    width: 70,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  detailValue: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },

  sectionLabel: {
    fontSize: 11,             // DESIGN §1.7 — micro label
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1.2,
    marginBottom: 8,          // DESIGN §1.3 — on-grid
  },

  photoCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,         // DESIGN §1.6 — standard card
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  photoThumb: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  photoMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },

  retakeButton: {
    marginTop: 12,            // DESIGN §1.3 — on-grid
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  retakeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  errorBox: {
    backgroundColor: colors.statusFailedBg,
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: colors.statusFailed,
    fontSize: 14,
    fontWeight: '500',
  },

  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,  // DESIGN §2.4 — standard page margin
    paddingTop: 12,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    height: 64,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.white,
  },
  completeTag: {
    backgroundColor: colors.statusCompleteBg,
  },
  completeTagText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.statusComplete,
  },
});
