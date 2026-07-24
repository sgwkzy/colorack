// components/PaintDetailModal.tsx
// 色詳細(閲覧/編集)モーダル。塗料一覧・塗料追加モーダルの各閲覧タブから共通で開く。
// モーダル方式にしているのは、呼び出し元(一覧やAddPaintモーダル)を閉じずに
// 「詳細を見る→戻る→別の色を見る」を繰り返せるようにするため。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconCamera, IconChevronDown, IconChevronLeft, IconHeart, IconPencil, IconShoppingCartPlus, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { logEvent } from '../lib/analytics';
import { brandLabel } from '../lib/brands';
import { readableTextColor } from '../lib/color';
import {
  CatalogPaintDetail,
  deletePaint,
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
import { t, useLocale } from '../lib/i18n';
import { paintName, seriesLabel } from '../lib/paintLabel';
import { paintTypeLabel } from '../lib/paintType';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import ActionSheet from './ActionSheet';
import ColorCameraPicker from './ColorCameraPicker';
import { GLOSS_OPTIONS, isValidHex, optionChip, TYPE_OPTIONS } from './PaintFormFields';
import SwipeBack from './SwipeBack';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';
import Toast from './Toast';
import { useModalLock } from '../lib/modalLock';

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

function toneColors(hex: string | null): string[] {
  const value = hex?.replace('#', '');
  if (!value || !/^[0-9a-f]{6}$/i.test(value)) return ['#e5e5e5', '#ccc', '#aaa', '#888', '#666', '#444'];
  const base = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  return [-0.55, -0.3, -0.1, 0.1, 0.3, 0.55].map((amount) => {
    const channel = (value: number) => Math.round(amount < 0 ? value * (1 + amount) : value + (255 - value) * amount);
    return `rgb(${channel(base[0])}, ${channel(base[1])}, ${channel(base[2])})`;
  });
}

export default function PaintDetailModal({ visible, paintId, onClose, onChanged, initialEditing = false }: Props) {
  useModalLock(visible);
  const locale = useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [detail, setDetail] = useState<CatalogPaintDetail | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [nameJa, setNameJa] = useState('');
  const [nameEn, setNameEn] = useState('');
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
  const [boxPickerVisible, setBoxPickerVisible] = useState(false);
  const [showFullName, setShowFullName] = useState(false);
  const [membership, setMembership] = useState({ favorites: false, wishlist: false });
  const [stockStatus, setStockStatus] = useState<StockStatusRow[]>([]);
  const loadVersionRef = useRef(0);
  const [busy, setBusy] = useState(false);

  const master = detail?.source === 'catalog' ? getMasterCatalogPaint(detail.catalog_code) : null;
  const isManual = detail?.source === 'manual';
  const finish = detail?.gloss === 'メタリック' || detail?.gloss === 'パール';
  const canSave = (nameJa.trim() !== '' || nameEn.trim() !== '') && (isManual ? brand.trim() !== '' && series.trim() !== '' : true);
  const hasUnsavedChanges = isEditing && detail != null && (
    nameJa !== (detail.name_ja ?? '')
    || nameEn !== (detail.name_en ?? '')
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
    setNameEn(paint.name_en ?? '');
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
    const loadVersion = ++loadVersionRef.current;
    const row = await getCatalogPaintDetail(paintId);
    if (loadVersion !== loadVersionRef.current) return;
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
    if (loadVersion !== loadVersionRef.current) return;
    setMembership(nextMembership);
    setStockStatus(stockRows);
  }, [paintId, syncFields]);

  // 開くたびに対象を読み込み、閉じている間は状態をリセットしておく。
  useEffect(() => {
    if (visible) {
      load();
      setIsEditing(initialEditing);
      getDB().getAllAsync<Box>('SELECT id, name FROM boxes ORDER BY sort_order, id').then(setBoxes);
      getDefaultBoxId().then(setSelectedBoxId);
    } else {
      setDetail(null);
      setIsEditing(false);
      setMembership({ favorites: false, wishlist: false });
      setStockStatus([]);
    }
  }, [visible, load, initialEditing]);

  useEffect(() => setShowFullName(false), [paintId, visible]);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  };

  const addToBox = async () => {
    if (!detail || busy) return;
    setBusy(true);
    try { await getDB().runAsync(
      'INSERT INTO inventory (paint_id, status, box_id) VALUES (?, ?, ?)',
      [detail.id, 'owned', selectedBoxId]
    );
    showToast(paintName(detail.name_ja, detail.name_en) + t('addedToast'));
    onChanged?.();
    } finally { setBusy(false); }
  };

  const toggleList = async (type: 'favorites' | 'wishlist') => {
    if (!detail || busy) return;
    setBusy(true);
    try {
    const isMember = membership[type];
    if (isMember) {
      await removeFromList(detail.id, type);
      logEvent('add_to_list', { list_type: type, action: 'remove' });
      showToast(paintName(detail.name_ja, detail.name_en) + t('removedToast'));
    } else {
      await getDB().runAsync('INSERT OR IGNORE INTO lists (type, paint_id) VALUES (?, ?)', [type, detail.id]);
      logEvent('add_to_list', { list_type: type, action: 'add' });
      showToast(paintName(detail.name_ja, detail.name_en) + t('addedToast'));
    }
    setMembership((m) => ({ ...m, [type]: !isMember }));
    onChanged?.();
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!detail || busy) return;
    setBusy(true);
    const pairedNameJa = nameJa.trim() || nameEn.trim();
    const pairedNameEn = nameEn.trim() || nameJa.trim();
    try {
      if (detail.source === 'manual') {
        await updateManualPaint(detail.id, { nameJa: pairedNameJa, nameEn: pairedNameEn, brand, series, code, hex, gloss, paintType });
      } else {
        await updateCatalogPaintContent(detail.id, { nameJa: pairedNameJa, nameEn: pairedNameEn, hex, gloss, paintType });
      }
      await updateCatalogPaintNotes(detail.id, notes);
      await load();
      setIsEditing(false);
      onChanged?.();
    } catch { Alert.alert(t('inputError'), t('duplicateCodeError')); }
    finally { setBusy(false); }
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
          await deletePaint(detail.id);
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

  const returnToDetail = () => {
    if (!hasUnsavedChanges) {
      setIsEditing(false);
      return;
    }
    Alert.alert(t('discardChangesConfirm'), '', [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('discard'), style: 'destructive',
        onPress: () => {
          if (detail) syncFields(detail);
          setIsEditing(false);
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
  const swatchColor = detail?.hex || colors.transparent;
  const swatchTextColor = detail?.hex ? readableTextColor(detail.hex) : colors.text;
  const tooltipBackground = detail?.hex
    ? (swatchTextColor === '#fff' ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.92)')
    : colors.surface;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={requestClose}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible} onBack={isEditing ? returnToDetail : requestClose}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <SwipeDownHeader onClose={isEditing ? returnToDetail : requestClose}>
            <View style={styles.header}>
              {isEditing ? (
                <TouchableOpacity style={[styles.headerAction, styles.headerBack]} onPress={returnToDetail} hitSlop={8} accessibilityLabel={t('paintDetailTitle')}>
                  <IconChevronLeft color={colors.text} size={26} />
                </TouchableOpacity>
              ) : null}
              <Text style={styles.title}>{isEditing ? t('editPaint') : t('paintDetailTitle')}</Text>
              <TouchableOpacity style={[styles.headerAction, styles.headerClose]} onPress={requestClose} hitSlop={8} accessibilityLabel={t('close')}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>

          {!detail ? (
            <Text style={styles.empty}>{t('noResults')}</Text>
          ) : !isEditing ? (
            <SwipeDownScrollView style={styles.scroll} onClose={requestClose} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.md }]}>
              <View style={styles.colorSpecimen}>
              <View style={[styles.swatch, { backgroundColor: swatchColor }]}>
                {finish ? (
                  <View pointerEvents="none" style={styles.finishOverlay}>
                    <Svg width="100%" height="100%" preserveAspectRatio="none">
                      <Defs>
                        <LinearGradient id="metallic-sheen" x1="0" y1="1" x2="1" y2="0">
                          <Stop offset="0" stopColor="#fff" stopOpacity={0} />
                          <Stop offset="1" stopColor="#fff" stopOpacity={0.34} />
                        </LinearGradient>
                      </Defs>
                      <Rect width="100%" height="100%" fill="url(#metallic-sheen)" />
                    </Svg>
                  </View>
                ) : null}
                <View style={styles.swatchLabel}>
                  <View style={styles.swatchBrandRow}>
                    <Text selectable style={[styles.swatchBrand, { color: swatchTextColor }]}>{brandLabel(detail.brand) || '—'}</Text>
                    <TouchableOpacity style={styles.editBtn} onPress={() => setIsEditing(true)} hitSlop={8} accessibilityLabel={t('editPaint')}>
                      <IconPencil color={swatchTextColor} size={20} />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => setShowFullName((shown) => !shown)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={paintName(detail.name_ja, detail.name_en)}>
                    <Text selectable numberOfLines={1} style={[styles.swatchName, { color: swatchTextColor }]}>{paintName(detail.name_ja, detail.name_en)}</Text>
                  </TouchableOpacity>
                  {showFullName ? (
                    <View style={[styles.nameTooltip, { backgroundColor: tooltipBackground }]}>
                      <Text selectable style={[styles.nameTooltipText, { color: swatchTextColor }]}>{paintName(detail.name_ja, detail.name_en)}</Text>
                    </View>
                  ) : null}
                  {detail.code ? <Text selectable style={[styles.swatchCode, { color: swatchTextColor }]}>{detail.code}</Text> : null}
                  {detail.hex ? <Text selectable style={[styles.swatchHex, { color: swatchTextColor }]}>{detail.hex.toUpperCase()}</Text> : null}
                </View>
              </View>

              <View style={styles.toneRail}>
                {toneColors(detail.hex).map((color, index) => <View key={index} style={[styles.toneStep, { backgroundColor: color }]} />)}
              </View>
              </View>

              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.button, styles.toggleButton, membership.favorites && styles.deleteButton]}
                  onPress={() => toggleList('favorites')}
                  disabled={busy}
                >
                  <IconHeart size={16} color={membership.favorites ? colors.danger : colors.text} style={styles.toggleIcon} />
                  <Text numberOfLines={1} style={[styles.buttonText, membership.favorites && styles.deleteButtonText]}>
                    {membership.favorites ? t('removeFromFavorites') : t('favorites')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.toggleButton, membership.wishlist && styles.deleteButton]}
                  onPress={() => toggleList('wishlist')}
                  disabled={busy}
                >
                  <IconShoppingCartPlus size={16} color={membership.wishlist ? colors.danger : colors.text} style={styles.toggleIcon} />
                  <Text numberOfLines={1} style={[styles.buttonText, membership.wishlist && styles.deleteButtonText]}>
                    {membership.wishlist ? t('removeFromWishlist') : t('wishlist')}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.detailCard}>
                <CompactInfo label={t('brand')} value={brandLabel(detail.brand)} styles={styles} />
                <CompactInfo label={t('series')} value={seriesLabel(detail.series, detail.series_en)} styles={styles} />
                <CompactInfo label={t('paintType')} value={paintTypeLabel(detail.paint_type)} styles={styles} />
                <CompactInfo label={t('gloss')} value={glossLabel(detail.gloss)} styles={styles} />
              </View>

              {stockStatus.length > 0 ? (
                <View style={styles.ledgerCard}>
                  <Text style={styles.sectionTitle}>{t('ownedStatus')}</Text>
                  <View style={styles.stockStatusRow}>
                    {stockStatus.map((row) => (
                      <View key={`${row.box_name}-${row.status}`} style={styles.stockItem}>
                        <View style={[styles.statusDot, { backgroundColor: row.status === 'owned' ? colors.primary : colors.inUse }]} />
                        <Text style={styles.stockStatusText}>{row.status === 'owned' ? (row.box_name ?? t('unassigned')) : statusLabel(row.status)} ×{row.n}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.ledgerCard}>
                <Text style={styles.sectionTitle}>{t('paintNotes')}</Text>
                <Text style={styles.quote}>{detail.notes || '—'}</Text>
              </View>

              <View style={styles.addGroup}>
                <Text style={styles.label}>{t('targetBox')}</Text>
                <TouchableOpacity style={styles.boxPicker} onPress={() => setBoxPickerVisible(true)}>
                  <Text numberOfLines={1} style={styles.boxPickerText}>{boxes.find((box) => box.id === selectedBoxId)?.name ?? t('unassigned')}</Text>
                  <IconChevronDown color={colors.textMuted} size={18} />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.primaryButton, styles.fullWidth]} onPress={addToBox} disabled={busy}>
                  <Text style={styles.primaryButtonText}>{t('addToBox')}</Text>
                </TouchableOpacity>
              </View>
            </SwipeDownScrollView>
          ) : (
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <SwipeDownScrollView style={styles.scroll} onClose={returnToDetail} contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              <EditField label={locale === 'ja' ? '名前（和名）' : 'Name (Japanese)'} value={nameJa} onChangeText={setNameJa} styles={styles} />
              {masterLine(nameJa, master?.name_ja)}
              <EditField label={locale === 'ja' ? '名前（英名）' : 'Name (English)'} value={nameEn} onChangeText={setNameEn} styles={styles} />
              {masterLine(nameEn, master?.name_en)}

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
                  <TouchableOpacity style={styles.cameraBtn} onPress={() => setColorPickerVisible(true)} accessibilityLabel={t('pickColorWithCamera')}>
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
            <SafeAreaView edges={['bottom']} style={styles.saveArea}>
              <TouchableOpacity
                style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
                onPress={save}
                disabled={!canSave || busy}
              >
                <Text style={styles.saveBtnText}>{t('save')}</Text>
              </TouchableOpacity>
            </SafeAreaView>
            </KeyboardAvoidingView>
          )}

          <Toast message={toast} />
          <ActionSheet
            visible={boxPickerVisible}
            title={t('targetBox')}
            buttons={[
              ...boxes.map((box) => ({ text: `${box.id === selectedBoxId ? '✓ ' : ''}${box.name}`, onPress: () => setSelectedBoxId(box.id) })),
              { text: t('cancel'), style: 'cancel' },
            ]}
            onClose={() => setBoxPickerVisible(false)}
          />
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
  header: { position: 'relative', alignItems: 'center', justifyContent: 'center', minHeight: 56, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  headerAction: { position: 'absolute', top: 0, bottom: 0, width: touch.min, alignItems: 'center', justifyContent: 'center' },
  headerBack: { left: spacing.md },
  headerClose: { right: spacing.md },
  scroll: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg },
  colorSpecimen: { overflow: 'hidden', borderRadius: radius.md, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.borderLight },
  swatch: { height: 156, overflow: 'hidden', justifyContent: 'flex-end', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
  finishOverlay: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  swatchLabel: { gap: spacing.xs, zIndex: 1, position: 'relative' },
  swatchBrandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  swatchBrand: { fontSize: 14, fontWeight: '600', opacity: 0.82 },
  swatchName: { fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.3 },
  nameTooltip: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, zIndex: 2 },
  nameTooltipText: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  swatchCode: { fontSize: 18, fontWeight: '600', marginTop: spacing.xs },
  swatchHex: { fontSize: 13, fontWeight: '600', opacity: 0.84, letterSpacing: 0.6 },
  sectionTitle: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  editBtn: { padding: spacing.sm, marginRight: -spacing.sm },
  toneRail: { height: 34, flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)' },
  toneStep: { flex: 1 },
  detailCard: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, paddingTop: spacing.lg },
  compactItem: { width: '50%', paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  compactLabel: { fontSize: 11, color: colors.textMuted },
  compactValue: { fontSize: 15, color: colors.text, fontWeight: '600', marginTop: 2 },
  ledgerCard: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  stockStatusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  stockItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  stockStatusText: { fontSize: 14, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  field: { marginBottom: spacing.lg },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.lg, color: colors.text },
  readonly: { borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.sm, padding: spacing.lg, color: colors.textFaint, backgroundColor: colors.surfaceAlt },
  quote: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
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
  addGroup: { borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  boxPicker: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.lg },
  boxPickerText: { flex: 1, color: colors.text, fontSize: 14 },
  fullWidth: { alignSelf: 'stretch' },
  toggleRow: { flexDirection: 'row', gap: spacing.md },
  toggleButton: { flex: 1, flexDirection: 'row' },
  toggleIcon: { marginRight: spacing.xs },
  button: { minHeight: touch.min, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { backgroundColor: colors.primary, borderColor: colors.primary },
  deleteButton: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  buttonText: { color: colors.text, fontWeight: 'bold' },
  primaryButtonText: { color: colors.onPrimary, fontWeight: 'bold' },
  deleteButtonText: { color: colors.dangerText, fontWeight: 'bold' },
  textAction: { alignSelf: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.xl },
  textActionLabel: { fontSize: 14, color: colors.dangerText, fontWeight: 'bold' },
  saveArea: { backgroundColor: colors.surface, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  saveBtn: { minHeight: touch.min, borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  saveBtnDisabled: { backgroundColor: colors.primaryDisabled },
  saveBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: 'bold' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
});
