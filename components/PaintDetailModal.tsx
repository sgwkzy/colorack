// components/PaintDetailModal.tsx
// 色詳細(閲覧/編集)モーダル。塗料一覧・塗料追加モーダルの各閲覧タブから共通で開く。
// モーダル方式にしているのは、呼び出し元(一覧やAddPaintモーダル)を閉じずに
// 「詳細を見る→戻る→別の色を見る」を繰り返せるようにするため。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconCamera, IconHeart, IconPencil, IconShoppingCartPlus, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { brandLabel } from '../lib/brands';
import {
  CatalogPaintDetail,
  getCatalogPaintDetail,
  getDB,
  getDefaultBoxId,
  getListMembership,
  getMasterCatalogPaint,
  removeFromList,
  resetCatalogPaintToMaster,
  updateCatalogPaintContent,
  updateCatalogPaintNotes,
  updateManualPaint,
} from '../lib/db';
import { glossLabel } from '../lib/gloss';
import { t } from '../lib/i18n';
import { paintName, seriesLabel } from '../lib/paintLabel';
import { paintTypeLabel } from '../lib/paintType';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import ColorCameraPicker from './ColorCameraPicker';
import { GLOSS_OPTIONS, isValidHex, optionChip, TYPE_OPTIONS } from './PaintFormFields';
import SwipeBack from './SwipeBack';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';
import Toast from './Toast';

interface Box { id: number; name: string; }
interface StockStatusRow { box_name: string | null; status: string; n: number; }

interface Props {
  visible: boolean;
  paintId: number | null;
  onClose: () => void;
  onChanged?: () => void; // 保存/リセット/削除で内容が変わった時、呼び出し元に一覧再読み込みを促す
  // trueで開くと最初から編集モードで表示する(色編集ボタンからの遷移用)。
  initialEditing?: boolean;
}

export default function PaintDetailModal({ visible, paintId, onClose, onChanged, initialEditing = false }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [detail, setDetail] = useState<CatalogPaintDetail | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [nameJa, setNameJa] = useState('');
  const [brand, setBrand] = useState('');
  const [series, setSeries] = useState('');
  const [code, setCode] = useState('');
  const [hex, setHex] = useState('');
  const [paintType, setPaintType] = useState<string | null>(null);
  const [gloss, setGloss] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<number | null>(null);
  const [membership, setMembership] = useState({ favorites: false, wishlist: false });
  const [stockStatus, setStockStatus] = useState<StockStatusRow[]>([]);

  const master = detail?.source === 'catalog' ? getMasterCatalogPaint(detail.catalog_code) : null;
  const isManual = detail?.source === 'manual';
  const canSave = nameJa.trim() !== '' && (isManual ? brand.trim() !== '' && series.trim() !== '' : true);
  const hasUnsavedChanges = isEditing && detail != null && (
    nameJa !== (detail.name_ja ?? '')
    || brand !== (detail.brand ?? '')
    || series !== (detail.series ?? '')
    || code !== (detail.code ?? '')
    || hex !== (detail.hex ?? '')
    || paintType !== (detail.paint_type ?? null)
    || gloss !== (detail.gloss ?? null)
    || notes !== (detail.notes ?? '')
  );

  const syncFields = useCallback((paint: CatalogPaintDetail) => {
    setNameJa(paint.name_ja ?? '');
    setBrand(paint.brand ?? '');
    setSeries(paint.series ?? '');
    setCode(paint.code ?? '');
    setHex(paint.hex ?? '');
    setPaintType(paint.paint_type ?? null);
    setGloss(paint.gloss ?? null);
    setNotes(paint.notes ?? '');
  }, []);

  const load = useCallback(async () => {
    if (paintId == null) return;
    const row = await getCatalogPaintDetail(paintId);
    setDetail(row);
    if (row) syncFields(row);
    const [nextMembership, stockRows] = await Promise.all([
      getListMembership(paintId),
      getDB().getAllAsync<StockStatusRow>(
        'SELECT b.name AS box_name, i.status, COUNT(*) AS n'
        + ' FROM inventory i LEFT JOIN boxes b ON i.box_id = b.id'
        + " WHERE i.paint_id = ? AND i.status != 'used_up'"
        + ' GROUP BY i.box_id, i.status',
        [paintId]
      ),
    ]);
    setMembership(nextMembership);
    setStockStatus(stockRows);
  }, [paintId, syncFields]);

  // 開くたびに対象を読み込み、閉じている間は状態をリセットしておく。
  useEffect(() => {
    if (visible) {
      load();
      setIsEditing(initialEditing);
      getDB().getAllAsync<Box>('SELECT id, name FROM boxes ORDER BY id').then(setBoxes);
      getDefaultBoxId().then(setSelectedBoxId);
    } else {
      setDetail(null);
      setIsEditing(false);
      setMembership({ favorites: false, wishlist: false });
      setStockStatus([]);
    }
  }, [visible, load, initialEditing]);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  };

  const addToBox = async () => {
    if (!detail) return;
    await getDB().runAsync(
      'INSERT INTO inventory (paint_id, status, box_id) VALUES (?, ?, ?)',
      [detail.id, 'owned', selectedBoxId]
    );
    showToast(paintName(detail.name_ja, detail.name_en) + t('addedToast'));
    onChanged?.();
  };

  const toggleList = async (type: 'favorites' | 'wishlist') => {
    if (!detail) return;
    const isMember = membership[type];
    if (isMember) {
      await removeFromList(detail.id, type);
      showToast(paintName(detail.name_ja, detail.name_en) + t('removedToast'));
    } else {
      await getDB().runAsync('INSERT INTO lists (type, paint_id) VALUES (?, ?)', [type, detail.id]);
      showToast(paintName(detail.name_ja, detail.name_en) + t('addedToast'));
    }
    setMembership((m) => ({ ...m, [type]: !isMember }));
    onChanged?.();
  };

  const save = async () => {
    if (!detail) return;
    try {
      if (detail.source === 'manual') {
        await updateManualPaint(detail.id, { nameJa, brand, series, code, hex, gloss, paintType });
      } else {
        await updateCatalogPaintContent(detail.id, { nameJa, hex, gloss, paintType });
      }
      await updateCatalogPaintNotes(detail.id, notes);
      await load();
      setIsEditing(false);
      onChanged?.();
    } catch {
      Alert.alert('入力エラー', '同じブランド内に同じ品番が既に登録されています。別の品番にしてください。');
    }
  };

  const resetToMaster = () => {
    if (!detail) return;
    Alert.alert(t('reset'), t('resetToMasterConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('reset'),
        onPress: async () => {
          await resetCatalogPaintToMaster(detail.id, detail.catalog_code);
          await load();
          setIsEditing(false);
          onChanged?.();
        },
      },
    ]);
  };

  const remove = () => {
    if (!detail) return;
    Alert.alert(paintName(detail.name_ja, detail.name_en), t('deletePaintConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          const db = getDB();
          await db.runAsync('DELETE FROM inventory WHERE paint_id = ?', [detail.id]);
          await db.runAsync('DELETE FROM lists WHERE paint_id = ?', [detail.id]);
          await db.runAsync('DELETE FROM catalog_paints WHERE id = ?', [detail.id]);
          onChanged?.();
          onClose();
        },
      },
    ]);
  };

  const requestClose = () => {
    if (!hasUnsavedChanges) {
      onClose();
      return;
    }
    Alert.alert(t('discardChangesConfirm'), '', [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('discard'), style: 'destructive',
        onPress: () => {
          if (detail) syncFields(detail);
          setIsEditing(false);
          onClose();
        },
      },
    ]);
  };

  const masterLine = (currentValue: string | null, masterValue: string | null | undefined, formatter = (v: string) => v) => {
    if (!master || (currentValue ?? '') === (masterValue ?? '')) return null;
    return <Text style={styles.masterText}>{t('masterValue')}: {formatter(masterValue ?? '')}</Text>;
  };

  const statusLabel = (status: string) => {
    if (status === 'owned') return t('statusOwned');
    if (status === 'in_use') return t('statusInUse');
    if (status === 'used_up') return t('statusUsedUp');
    return status;
  };

  const stockStatusText = stockStatus
    .map((row) => `${row.status === 'owned' ? (row.box_name ?? t('unassigned')) : statusLabel(row.status)} ×${row.n}`)
    .join(' · ');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={requestClose}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible && !isEditing} onBack={requestClose}>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={requestClose}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('paintDetailTitle')}</Text>
              <TouchableOpacity onPress={requestClose} hitSlop={8}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>

          {!detail ? (
            <Text style={styles.empty}>{t('noResults')}</Text>
          ) : !isEditing ? (
            <SwipeDownScrollView onClose={requestClose} contentContainerStyle={styles.content}>
              <View style={[styles.swatch, { backgroundColor: detail.hex ?? colors.transparent, borderColor: colors.border }]}>
                {detail.hex ? <Text style={styles.hexBadge}>{detail.hex.toUpperCase()}</Text> : null}
              </View>

              <View style={styles.titleRow}>
                <Text style={styles.paintTitle}>{paintName(detail.name_ja, detail.name_en)}</Text>
                <TouchableOpacity style={styles.editBtn} onPress={() => setIsEditing(true)} hitSlop={8}>
                  <IconPencil color={colors.primary} size={20} />
                </TouchableOpacity>
              </View>
              {detail.code ? <Text style={styles.codeLine}>{detail.code}</Text> : null}

              <View style={styles.compactGrid}>
                <CompactInfo label={t('brand')} value={brandLabel(detail.brand)} styles={styles} />
                <CompactInfo label={t('series')} value={seriesLabel(detail.series, detail.series_en)} styles={styles} />
                <CompactInfo label={t('paintType')} value={paintTypeLabel(detail.paint_type)} styles={styles} />
                <CompactInfo label={t('gloss')} value={glossLabel(detail.gloss)} styles={styles} />
              </View>

              {stockStatus.length > 0 ? (
                <View style={styles.stockStatusRow}>
                  <Text style={styles.stockStatusLabel}>{t('ownedStatus')}</Text>
                  <Text style={styles.stockStatusText}>{stockStatusText}</Text>
                </View>
              ) : null}

              <View style={styles.field}>
                <Text style={styles.label}>{t('paintNotes')}</Text>
                <Text style={styles.quote}>{detail.notes || '—'}</Text>
              </View>

              <View style={styles.addGroup}>
                <Text style={styles.label}>{t('targetBox')}</Text>
                <View style={styles.chipRow}>
                  {boxes.map((b) => optionChip(String(b.id), selectedBoxId === b.id, b.name, () => setSelectedBoxId(b.id), styles))}
                </View>
                <TouchableOpacity style={[styles.button, styles.primaryButton, styles.fullWidth]} onPress={addToBox}>
                  <Text style={styles.primaryButtonText}>{t('addToBox')}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.button, styles.toggleButton, membership.favorites && styles.deleteButton]}
                  onPress={() => toggleList('favorites')}
                >
                  <IconHeart size={16} color={membership.favorites ? colors.danger : colors.text} style={styles.toggleIcon} />
                  <Text numberOfLines={1} style={[styles.buttonText, membership.favorites && styles.deleteButtonText]}>
                    {membership.favorites ? t('removeFromFavorites') : t('favorites')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.toggleButton, membership.wishlist && styles.deleteButton]}
                  onPress={() => toggleList('wishlist')}
                >
                  <IconShoppingCartPlus size={16} color={membership.wishlist ? colors.danger : colors.text} style={styles.toggleIcon} />
                  <Text numberOfLines={1} style={[styles.buttonText, membership.wishlist && styles.deleteButtonText]}>
                    {membership.wishlist ? t('removeFromWishlist') : t('wishlist')}
                  </Text>
                </TouchableOpacity>
              </View>
            </SwipeDownScrollView>
          ) : (
            <>
            <SwipeDownScrollView onClose={requestClose} contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              <EditField label={t('name')} value={nameJa} onChangeText={setNameJa} styles={styles} />
              {masterLine(nameJa, master?.name_ja)}

              {isManual ? (
                <>
                  <EditField label={t('code')} value={code} onChangeText={setCode} styles={styles} />
                  <EditField label={t('brand')} value={brand} onChangeText={setBrand} styles={styles} />
                  <EditField label={t('series')} value={series} onChangeText={setSeries} styles={styles} />
                </>
              ) : (
                <>
                  <ReadonlyField label={t('code')} value={detail.code} styles={styles} />
                  <ReadonlyField label={t('brand')} value={brandLabel(detail.brand)} styles={styles} />
                  <ReadonlyField label={t('series')} value={seriesLabel(detail.series, detail.series_en)} styles={styles} />
                </>
              )}

              <View style={styles.field}>
                <Text style={styles.label}>{t('hex') + ' (#RRGGBB)'}</Text>
                <View style={styles.hexRow}>
                  <ClearableInput style={[styles.input, styles.hexInput]} value={hex} onChangeText={setHex} autoCapitalize="none" />
                  {isValidHex(hex) && <View style={[styles.previewSwatch, { backgroundColor: `#${hex.replace('#', '')}` }]} />}
                  <TouchableOpacity style={styles.cameraBtn} onPress={() => setColorPickerVisible(true)} accessibilityLabel="カメラで色を取得">
                    <IconCamera color={colors.primary} size={22} />
                  </TouchableOpacity>
                </View>
                {masterLine(hex, master?.hex)}
              </View>

              <Text style={styles.label}>{t('paintType')}</Text>
              <View style={styles.chipRow}>
                {TYPE_OPTIONS.map((v) => optionChip(v, paintType === v, paintTypeLabel(v), () => setPaintType(paintType === v ? null : v), styles))}
              </View>
              {masterLine(paintType, master?.paint_type, paintTypeLabel)}

              <Text style={[styles.label, styles.sectionGap]}>{t('gloss')}</Text>
              <View style={styles.chipRow}>
                {GLOSS_OPTIONS.map((v) => optionChip(v, gloss === v, glossLabel(v), () => setGloss(gloss === v ? null : v), styles))}
              </View>
              {masterLine(gloss, master?.gloss, glossLabel)}

              <View style={styles.field}>
                <Text style={[styles.label, styles.sectionGap]}>{t('paintNotes')}</Text>
                <ClearableInput
                  style={[styles.input, styles.notesInput]}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  textAlignVertical="top"
                />
              </View>

              <View>
                {detail.source === 'catalog' && master ? (
                  <TouchableOpacity style={styles.textAction} onPress={resetToMaster}>
                    <Text style={styles.textActionLabel}>{t('resetToMaster')}</Text>
                  </TouchableOpacity>
                ) : null}
                {isManual ? (
                  <TouchableOpacity style={styles.textAction} onPress={remove}>
                    <Text style={styles.textActionLabel}>{t('delete')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </SwipeDownScrollView>
            <TouchableOpacity
              style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
              onPress={save}
              disabled={!canSave}
            >
              <Text style={styles.saveBtnText}>{t('save')}</Text>
            </TouchableOpacity>
            </>
          )}

          <Toast message={toast} />
          <ColorCameraPicker visible={colorPickerVisible} onClose={() => setColorPickerVisible(false)} onPick={setHex} />
        </SafeAreaView>
        </SwipeBack>
      </SafeAreaProvider>
    </Modal>
  );
}

function CompactInfo({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.compactItem}>
      <Text style={styles.compactLabel}>{label}</Text>
      <Text style={styles.compactValue}>{value || '—'}</Text>
    </View>
  );
}

function EditField({ label, value, onChangeText, styles }: { label: string; value: string; onChangeText: (value: string) => void; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <ClearableInput style={styles.input} value={value} onChangeText={onChangeText} autoCapitalize="none" />
    </View>
  );
}

function ReadonlyField({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.readonly}>{value || '—'}</Text>
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  content: { padding: spacing.xl, paddingBottom: 96 },
  swatch: { height: 96, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.xl },
  hexBadge: { position: 'absolute', right: spacing.md, bottom: spacing.md, fontSize: 11, paddingHorizontal: spacing.md, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.9)', color: '#333', overflow: 'hidden' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  paintTitle: { fontSize: 22, fontWeight: 'bold', color: colors.text, flex: 1 },
  codeLine: { fontSize: 14, color: colors.textMuted, letterSpacing: 0.5, marginBottom: spacing.lg },
  editBtn: { padding: spacing.sm, marginLeft: spacing.md },
  compactGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.xl },
  compactItem: { width: '50%', marginBottom: spacing.md },
  compactLabel: { fontSize: 11, color: colors.textMuted },
  compactValue: { fontSize: 13, color: colors.textSecondary },
  stockStatusRow: { marginTop: -spacing.md, marginBottom: spacing.xl },
  stockStatusLabel: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  stockStatusText: { fontSize: 13, color: colors.textSecondary },
  field: { marginBottom: spacing.lg },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  readonly: { borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.sm, padding: 10, color: colors.textFaint, backgroundColor: colors.surfaceAlt },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.border, borderRadius: 0, paddingLeft: 10, paddingVertical: 2, fontSize: 12, color: colors.textFaint },
  hexRow: { flexDirection: 'row', alignItems: 'center' },
  hexInput: { flex: 1 },
  notesInput: { minHeight: 80, alignItems: 'flex-start' },
  previewSwatch: { marginLeft: spacing.md, width: touch.min, height: touch.min, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  cameraBtn: { marginLeft: spacing.md, width: touch.min, height: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.chip, marginRight: spacing.md, marginBottom: spacing.md },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textSecondary },
  chipTextOn: { color: colors.onPrimary, fontWeight: 'bold' },
  sectionGap: { marginTop: spacing.lg },
  masterText: { color: colors.textFaint, fontSize: 12, marginTop: -spacing.md, marginBottom: spacing.lg },
  addGroup: { borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg },
  fullWidth: { alignSelf: 'stretch' },
  toggleRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  toggleButton: { flex: 1, flexDirection: 'row' },
  toggleIcon: { marginRight: spacing.xs },
  button: { minHeight: touch.min, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { backgroundColor: colors.primary, borderColor: colors.primary },
  deleteButton: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  buttonText: { color: colors.text, fontWeight: 'bold' },
  primaryButtonText: { color: colors.onPrimary, fontWeight: 'bold' },
  deleteButtonText: { color: colors.danger, fontWeight: 'bold' },
  textAction: { alignSelf: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.xl },
  textActionLabel: { fontSize: 14, color: colors.danger, fontWeight: 'bold' },
  saveBtn: { backgroundColor: colors.primary, padding: spacing.xl, alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: colors.primaryDisabled },
  saveBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: 'bold' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
});
