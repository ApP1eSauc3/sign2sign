import { StyleSheet } from 'react-native';
import { colors } from '../../../utils/colors';

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },

  divider: { height: 1, backgroundColor: colors.adminDivider },

  // 8pt grid throughout — see screens/CLAUDE.md §1.3.
  footer: { gap: 8 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeMeta: { fontSize: 13, color: colors.adminTextTertiary },
  noticeBlocked: { fontSize: 13, color: colors.adminError },

  hero: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  heroSlot: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.adminTextTertiary,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  heroCode: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.adminText,
    letterSpacing: 6,
    fontVariant: ['tabular-nums'],
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 4,
  },
  heroStatItem: {
    fontSize: 13,
    color: colors.adminTextTertiary,
  },
  heroStatNum: {
    fontWeight: '700',
    color: colors.adminText,
  },
  heroStatDot: {
    color: colors.adminTextTertiary,
  },

  progressSection: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 8,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.adminDivider,
    borderRadius: 3,
  },
  progressFill: {
    height: 6,
    backgroundColor: colors.brand,
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: 13,
    color: colors.adminTextTertiary,
    fontWeight: '500',
  },

  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  errorText: {
    fontSize: 15,
    color: colors.adminError,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.adminBorder,
  },
  retryText: { fontSize: 14, fontWeight: '600', color: colors.brand },

  list: { paddingHorizontal: 16, paddingTop: 16 },
  listEmpty: { flex: 1 },
  separator: { height: 8 },

  // Job row footer content
  jobCompletedAt: {
    fontSize: 12,
    color: colors.adminSuccess,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  jobPhotoMissing: {
    fontSize: 12,
    color: colors.adminTextHint,
    marginTop: 4,
  },
});
