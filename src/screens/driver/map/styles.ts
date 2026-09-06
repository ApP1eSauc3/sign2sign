import { StyleSheet } from 'react-native';
import { colors } from '../../../utils/colors';

export const styles = StyleSheet.create({
  // Route-degraded advisory. Same strip language as OfflineBanner so the two
  // read as one family when both are showing. Amber on dark amber:
  // statusProgress is documented as the max-peripheral-visibility, CVD-safe
  // token — the right choice for something glanced at in sunlight.
  degradedBanner: {
    backgroundColor: colors.statusProgressBg,
    paddingHorizontal: 16,   // DESIGN §2.4 — standard page margin
    paddingVertical: 12,     // spacing grid
    borderTopWidth: 1,
    borderTopColor: colors.statusProgress,
  },
  degradedText: {
    color: colors.statusProgress,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },

  root: { flex: 1, backgroundColor: colors.bg },

  // Top floating bar
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 17, 23, 0.88)',  // colors.bg at ~88% opacity
    paddingBottom: 4,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,    // DESIGN §2.4 — standard page margin
    paddingBottom: 12,
  },
  overlayButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,           // DESIGN §1.6 — input field radius
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 40,             // DESIGN §3.4 — icon-button minimum
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  progressPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 99,          // DESIGN §1.6 — capsule badge
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 110,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressPillComplete: {
    borderColor: colors.statusComplete,
    backgroundColor: colors.statusCompleteBg,
  },
  progressText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  progressTextComplete: {
    color: colors.statusComplete,
  },

  // Map pin
  pinContainer: { alignItems: 'center' },
  pinCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
  pinComplete: { opacity: 0.45 },
  pinText: {
    color: colors.bg,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
  },
  pinPointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },

  // Callout card
  callout: {
    backgroundColor: colors.surface,
    borderRadius: 10,         // DESIGN §1.6 — standard card
    padding: 14,
    minWidth: 210,
    maxWidth: 270,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  calloutBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  calloutBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    borderWidth: 1,
  },
  calloutBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  calloutAddress: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 20,
    marginBottom: 4,
  },
  calloutMeta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  calloutCta: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.brand,
  },
});
