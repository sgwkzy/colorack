// KitDetailModal のスタイル定義。モーダル本体が肥大していたため切り出した。
import { StyleSheet } from 'react-native';
import { lightColors, radius, spacing } from '../../lib/theme';

export const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: spacing.xl, paddingRight: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  backBtn: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, gap: spacing.lg },
  titleBlock: { gap: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  nameActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  nameEditInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text, fontSize: 20, fontWeight: '700' },
  maker: { fontSize: 14, color: colors.textMuted },
  controlCard: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.lg },
  control: { flex: 1, gap: spacing.sm },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.borderLight },
  picker: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pickerText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  field: { gap: spacing.xs },
  fieldRow: { flexDirection: 'row', gap: spacing.lg },
  fieldHalf: { flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  tabBtn: { flex: 1, padding: spacing.md, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabText: { fontSize: 13, color: colors.textPlaceholder },
  tabTextActive: { color: colors.primaryText, fontWeight: 'bold' },
  sectionTitle: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  noteInput: { minHeight: 72, alignItems: 'flex-start' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
  editBar: { flexDirection: 'row', gap: spacing.md, padding: spacing.xl, borderTopWidth: 1, borderTopColor: colors.borderLight },
  deleteBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md },
  deleteBtnText: { color: colors.dangerText, fontWeight: '700', fontSize: 16 },
  saveEditBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radius.md },
  saveEditBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
});

export type KitDetailStyles = ReturnType<typeof makeStyles>;
