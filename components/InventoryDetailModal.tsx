// components/InventoryDetailModal.tsx
// 保管箱の在庫1点を閲覧し、メモだけ編集できる詳細モーダル。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { brandLabel } from '../lib/brands';
import { getInventoryDetail, InventoryDetail, updateInventoryNote } from '../lib/db';
import { glossLabel } from '../lib/gloss';
import { t } from '../lib/i18n';
import { paintName, seriesLabel } from '../lib/paintLabel';
import { paintTypeLabel } from '../lib/paintType';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import PaintDetailModal from './PaintDetailModal';
import SwipeBack from './SwipeBack';
import SwipeDownHeader from './SwipeDownHeader';

interface Props {
  visible: boolean;
  inventoryId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}

export default function InventoryDetailModal({ visible, inventoryId, onClose, onChanged }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [detail, setDetail] = useState<InventoryDetail | null>(null);
  const [note, setNote] = useState('');
  const [paintDetailVisible, setPaintDetailVisible] = useState(false);

  const load = useCallback(async () => {
    if (inventoryId == null) return;
    const row = await getInventoryDetail(inventoryId);
    setDetail(row);
    setNote(row?.note ?? '');
  }, [inventoryId]);

  useEffect(() => {
    if (visible) {
      load();
    } else {
      setDetail(null);
      setNote('');
      setPaintDetailVisible(false);
    }
  }, [visible, load]);

  const saveNote = async () => {
    if (!detail) return;
    await updateInventoryNote(detail.id, note);
    await load();
    onChanged?.();
  };

  const dateLabel = (value: string | null) => value ? value.slice(0, 10) : t('unknown');
  const statusLabel = (status: string) => {
    if (status === 'in_use') return t('statusInUse');
    if (status === 'used_up') return t('statusUsedUp');
    return t('statusOwned');
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible} onBack={onClose}>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={onClose}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('inventoryDetailTitle')}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>

          {!detail ? (
            <Text style={styles.empty}>{t('noResults')}</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              <View style={[styles.swatch, { backgroundColor: detail.hex ?? colors.transparent, borderColor: detail.hex ?? colors.border }]} />
              <Text style={styles.paintTitle}>{paintName(detail.name_ja, detail.name_en)}</Text>
              <Info label={t('brand')} value={brandLabel(detail.brand)} styles={styles} />
              <Info label={t('series')} value={seriesLabel(detail.series, detail.series_en)} styles={styles} />
              <Info label={t('code')} value={detail.code} styles={styles} />
              <Info label={t('hex')} value={detail.hex ?? ''} styles={styles} />
              <Info label={t('paintType')} value={paintTypeLabel(detail.paint_type)} styles={styles} />
              <Info label={t('gloss')} value={glossLabel(detail.gloss)} styles={styles} />
              <Info label={t('box')} value={detail.box_name ?? t('unassigned')} styles={styles} />
              <Info label={t('status')} value={statusLabel(detail.status)} styles={styles} />
              <Info label={t('addedAt')} value={dateLabel(detail.added_at)} styles={styles} />
              <Info label={t('statusChangedAt')} value={dateLabel(detail.status_changed_at)} styles={styles} />

              <View style={styles.field}>
                <Text style={styles.label}>{t('note')}</Text>
                <ClearableInput
                  style={[styles.input, styles.noteInput]}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  textAlignVertical="top"
                  onBlur={saveNote}
                />
              </View>

              <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={() => setPaintDetailVisible(true)}>
                <Text style={styles.primaryButtonText}>{t('viewCatalogDetail')}</Text>
              </TouchableOpacity>

              <PaintDetailModal
                visible={paintDetailVisible}
                paintId={detail.paint_id}
                onClose={() => setPaintDetailVisible(false)}
                onChanged={load}
                boxId={detail.box_id}
              />
            </ScrollView>
          )}
        </SafeAreaView>
        </SwipeBack>
      </SafeAreaProvider>
    </Modal>
  );
}

function Info({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || '—'}</Text>
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  content: { padding: spacing.xl, paddingBottom: 96 },
  swatch: { height: 96, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.xl },
  paintTitle: { fontSize: 22, fontWeight: 'bold', color: colors.text, marginBottom: spacing.xl },
  infoRow: { paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  infoLabel: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  infoValue: { fontSize: 16, color: colors.text },
  field: { marginTop: spacing.xl, marginBottom: spacing.lg },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  noteInput: { minHeight: 96, alignItems: 'flex-start' },
  button: { minHeight: touch.min, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  primaryButton: { backgroundColor: colors.primary, borderColor: colors.primary },
  primaryButtonText: { color: colors.onPrimary, fontWeight: 'bold' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
});
