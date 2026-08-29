import { useMemo } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconCheck, IconPencil, IconTrash, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandLabel } from '../lib/brands';
import { mixHexColors } from '../lib/colorMix';
import { ColorMixSummary } from '../lib/colorMixDraft';
import { t, useLocale } from '../lib/i18n';
import { paintName, seriesLabel } from '../lib/paintLabel';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import { useModalLock } from '../lib/modalLock';
import SwipeBack from './SwipeBack';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';

interface Props {
  visible: boolean;
  color: ColorMixSummary | null;
  editable: boolean;
  ownedMap?: Map<number, number>;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function ColorMixDetailModal({ visible, color, editable, ownedMap, onEdit, onDelete, onClose }: Props) {
  useModalLock(visible);
  useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const resultHex = color && color.paints.length > 0 && color.paints.every((paint) => paint.hex && /^#?[0-9a-fA-F]{6}$/.test(paint.hex))
    ? mixHexColors(color.paints.map((paint) => ({ hex: paint.hex as string, ratio: paint.ratio })))
    : null;
  const name = color?.name?.trim() || (color?.paints[0] ? paintName(color.paints[0].name_ja, color.paints[0].name_en) : t('mixResult'));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible} onBack={onClose}>
          <SafeAreaView style={styles.container} edges={['top']}>
            <SwipeDownHeader onClose={onClose}>
              <View style={styles.header}>
                <Text style={styles.title}>{t('mixResult')}</Text>
                <TouchableOpacity style={styles.headerAction} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('close')}>
                  <IconX color={colors.text} size={24} />
                </TouchableOpacity>
              </View>
            </SwipeDownHeader>

            {!color ? (
              <Text style={styles.empty}>{t('noResults')}</Text>
            ) : (
              <SwipeDownScrollView
                style={styles.scroll}
                onClose={onClose}
                contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.resultCard}>
                  <View style={[styles.resultSwatch, { backgroundColor: resultHex ?? colors.chip }]} />
                  <View style={styles.resultInfo}>
                    <Text selectable style={styles.resultName}>{name}</Text>
                    <Text selectable style={styles.resultHex}>{resultHex?.toUpperCase() ?? t('cannotCalculateMix')}</Text>
                  </View>
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>{t('note')}</Text>
                  <Text selectable style={styles.note}>{color.note?.trim() || '—'}</Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>{t('usedPaints')}</Text>
                  <View style={styles.paintList}>
                    {color.paints.map((paint) => {
                      const owned = (ownedMap?.get(paint.paint_id) ?? 0) > 0;
                      return (
                        <View key={paint.paint_id} style={styles.paintRow}>
                          <View style={[styles.paintSwatch, { backgroundColor: paint.hex ?? colors.chip }]} />
                          <View style={styles.paintInfo}>
                            <Text selectable style={styles.paintBrand}>{brandLabel(paint.brand) || '—'}</Text>
                            <Text selectable style={styles.paintSeries}>{seriesLabel(paint.series, paint.series_en) || '—'}</Text>
                            <Text selectable style={styles.paintCodeName}>{paint.code || '—'} · {paintName(paint.name_ja, paint.name_en) || '—'}</Text>
                            <View style={styles.paintMeta}>
                              <Text style={styles.ratio}>{Math.round(paint.ratio * 100)}%</Text>
                              {owned ? (
                                <View style={styles.owned}>
                                  <IconCheck color={colors.success} size={16} />
                                  <Text style={styles.ownedText}>{t('ownedBadge')}</Text>
                                </View>
                              ) : null}
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {editable ? (
                  <View style={styles.actions}>
                    <TouchableOpacity style={[styles.actionButton, styles.editButton]} onPress={onEdit} accessibilityRole="button" accessibilityLabel={t('editMix')}>
                      <IconPencil color={colors.primaryText} size={20} />
                      <Text style={[styles.actionText, styles.editText]}>{t('editMix')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionButton, styles.deleteButton]} onPress={onDelete} accessibilityRole="button" accessibilityLabel={t('delete')}>
                      <IconTrash color={colors.danger} size={20} />
                      <Text style={[styles.actionText, styles.deleteText]}>{t('delete')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </SwipeDownScrollView>
            )}
          </SafeAreaView>
        </SwipeBack>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  headerAction: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, gap: spacing.lg },
  resultCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md },
  resultSwatch: { width: 128, height: 128, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  resultInfo: { flex: 1, gap: spacing.sm },
  resultName: { color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: '700' },
  resultHex: { color: colors.textMuted, fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },
  card: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md },
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  note: { color: colors.textSecondary, fontSize: 15, lineHeight: 21 },
  paintList: { gap: 0 },
  paintRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
  paintSwatch: { width: 48, height: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  paintInfo: { flex: 1, gap: 2 },
  paintBrand: { color: colors.text, fontSize: 14, fontWeight: '700' },
  paintSeries: { color: colors.textSecondary, fontSize: 13 },
  paintCodeName: { color: colors.text, fontSize: 14 },
  paintMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.xs },
  ratio: { color: colors.primaryText, fontSize: 14, fontWeight: '700' },
  owned: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  ownedText: { color: colors.success, fontSize: 12, fontWeight: '600' },
  actions: { gap: spacing.md, marginTop: spacing.sm },
  actionButton: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
  editButton: { backgroundColor: colors.primarySoft, borderColor: colors.primaryDisabled },
  deleteButton: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  actionText: { fontSize: 15, fontWeight: '700' },
  editText: { color: colors.primaryText },
  deleteText: { color: colors.dangerText },
  empty: { marginTop: 40, textAlign: 'center', color: colors.textPlaceholder },
});
