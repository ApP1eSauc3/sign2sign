import { StyleSheet } from 'react-native';
import { colors } from '../../../utils/colors';

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: colors.white,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.adminText },
  headerSub: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.brand,
    letterSpacing: 1.5,
    marginTop: 1,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  signOutButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.adminBorder,
  },
  signOutText: { fontSize: 14, fontWeight: '600', color: colors.adminTextSecondary },

  divider: { height: 1, backgroundColor: colors.adminDivider },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 24 },  // DESIGN §2.4 — standard page margin

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.adminTextTertiary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  sectionAction: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  sectionActionDisabled: { opacity: 0.4 },
  sectionActionConnected: { borderColor: colors.adminSuccess, backgroundColor: colors.adminSuccessBg },
  sectionActionText: { fontSize: 13, fontWeight: '600', color: colors.brand },

  emptyText: { fontSize: 15, color: colors.adminTextTertiary },
  emptyHint: { fontSize: 13, color: colors.adminTextHint, marginTop: 4 },

  // Codes grid
  codesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  codeCardWrap: {
    minWidth: '47%',
    flex: 1,
  },
  codeSlot: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.adminTextTertiary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  codeValue: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.adminText,
    letterSpacing: 4,
    fontVariant: ['tabular-nums'],
  },
  codeSelectedLabel: {
    fontSize: 11,
    color: colors.brand,
    fontWeight: '600',
    marginTop: 6,
  },

  // Sheet format reference
  sheetFormatCard: {
    backgroundColor: colors.adminDivider,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    gap: 3,
  },
  sheetFormatTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.adminTextTertiary,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  sheetFormatRow: {
    fontSize: 12,
    color: colors.adminTextSecondary,
    fontVariant: ['tabular-nums'],
  },
  sheetFormatHint: {
    color: colors.adminTextHint,
    fontStyle: 'italic',
  },
  sheetFormatNote: {
    fontSize: 11,
    color: colors.adminTextHint,
    marginTop: 8,
    lineHeight: 16,
  },

  assignNote: { fontSize: 13, color: colors.brand, fontWeight: '600', marginBottom: 12 },
  assignHint: { fontSize: 13, color: colors.adminTextHint, marginBottom: 12 },
  importResult: { fontSize: 14, fontWeight: '500', marginBottom: 12 },
  importResultSuccess: { color: colors.adminSuccess },
  importResultError: { color: colors.adminError },

  // Driver count stepper
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,   // overrides AdminCard's uniform padding — matches original paddingHorizontal:16/paddingVertical:12
    marginBottom: 10,
  },
  stepperLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.adminTextSecondary,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.adminBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonDisabled: { opacity: 0.3 },
  stepperButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.adminText,
    lineHeight: 22,
  },
  stepperValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.adminText,
    minWidth: 20,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },

  // Routes list
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  routeRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.adminDivider },
  routeSlotDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.statusComplete,
    marginRight: 12,
  },
  routeRowContent: { flex: 1 },
  routeSlotLabel: { fontSize: 14, fontWeight: '600', color: colors.adminText },
  routeCode: {
    fontSize: 13,
    color: colors.adminTextTertiary,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  routeRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  routeActiveBadge: {
    backgroundColor: colors.statusCompleteBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  routeActiveBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.statusComplete,
    letterSpacing: 0.8,
  },
  routeChevron: {
    fontSize: 18,
    color: colors.adminTextTertiary,
    fontWeight: '400',
  },
});
