// components/PaintDetailModal.tsx
// 色詳細(閲覧/編集)モーダル。塗料一覧・塗料追加モーダルの各閲覧タブから共通で開く。
// モーダル方式にしているのは、呼び出し元(一覧やAddPaintモーダル)を閉じずに
// 「詳細を見る→戻る→別の色を見る」を繰り返せるようにするため。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconCamera, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { brandLabel } from '../lib/brands';
import {
  CatalogPaintDetail,
  getCatalogPaintDetail,
  getDB,
  getDefaultBoxId,
  getMasterCatalogPaint,
  resetCatalogPaintToMaster,
  updateCatalogPaintContent,
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

interface Box { id: number; name: string; }

interface Props {
  visible: boolean;
  paintId: number | null;
  onClose: () => void;
  onChanged?: () => void; // 保存/リセット/削除で内容が変わった時、呼び出し元に一覧再読み込みを促す
  // 呼び出し元の文脈: 保管箱(owned)から開いた時はそのボックスを、
  // お気に入り/買い物リストから開いた時はそのリストへ追加する(ボックス選択は不要)。
  // 未指定(塗料一覧から開いた時など)はデフォルトボックスへの在庫追加として扱う。
  defaultStatus?: string;
  boxId?: number | null;
}

export default function PaintDetailModal({ visible, paintId, onClose, onChanged, defaultStatus = 'owned', boxId }: Props) {
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
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<number | null>(null);

  const isInventory = defaultStatus !== 'favorites' && defaultStatus !== 'wishlist';

  const master = detail?.source === 'catalog' ? getMasterCatalogPaint(detail.catalog_code) : null;
  const isManual = detail?.source === 'manual';
  const canSave = nameJa.trim() !== '' && (isManual ? brand.trim() !== '' && series.trim() !== '' : true);

  const syncFields = useCallback((paint: CatalogPaintDetail) => {
    setNameJa(paint.name_ja ?? '');
    setBrand(paint.brand ?? '');
    setSeries(paint.series ?? '');
    setCode(paint.code ?? '');
    setHex(paint.hex ?? '');
    setPaintType(paint.paint_type ?? null);
    setGloss(paint.gloss ?? null);
  }, []);

  const load = useCallback(async () => {
    if (paintId == null) return;
    const row = await getCatalogPaintDetail(paintId);
    setDetail(row);
    if (row) syncFields(row);
  }, [paintId, syncFields]);

  // 開くたびに対象を読み込み、閉じている間は状態をリセットしておく。
  useEffect(() => {
    if (visible) {
      load();
      if (isInventory) {
        getDB().getAllAsync<Box>('SELECT id, name FROM boxes ORDER BY id').then(setBoxes);
        // boxId指定があればそれを初期選択(保管箱から開いた時)、無指定ならデフォルトボックス(塗料一覧から開いた時)。
        (boxId !== undefined ? Promise.resolve(boxId) : getDefaultBoxId()).then(setSelectedBoxId);
      }
    } else {
      setDetail(null);
      setIsEditing(false);
    }
  }, [visible, load]);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  };

  const addToInventory = async () => {
    if (!detail) return;
    const db = getDB();
    if (isInventory) {
      await db.runAsync(
        'INSERT INTO inventory (paint_id, status, box_id) VALUES (?, ?, ?)',
        [detail.id, defaultStatus, selectedBoxId]
      );
    } else {
      await db.runAsync('INSERT INTO lists (type, paint_id) VALUES (?, ?)', [defaultStatus, detail.id]);
    }
    showToast(paintName(detail.name_ja, detail.name_en) + t('addedToast'));
  };

  const cancelEdit = () => {
    if (detail) syncFields(detail);
    setIsEditing(false);
  };

  const save = async () => {
    if (!detail) return;
    try {
      if (detail.source === 'manual') {
        await updateManualPaint(detail.id, { nameJa, brand, series, code, hex, gloss, paintType });
      } else {
        await updateCatalogPaintContent(detail.id, { nameJa, hex, gloss, paintType });
      }
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

  const masterLine = (currentValue: string | null, masterValue: string | null | undefined, formatter = (v: string) => v) => {
    if (!master || (currentValue ?? '') === (masterValue ?? '')) return null;
    return <Text style={styles.masterText}>{t('masterValue')}: {formatter(masterValue ?? '')}</Text>;
  };

  const displayHex = detail?.hex ?? '';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible} onBack={onClose}>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={onClose}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('paintDetailTitle')}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>

          {!detail ? (
            <Text style={styles.empty}>{t('noResults')}</Text>
          ) : !isEditing ? (
            <ScrollView contentContainerStyle={styles.content}>
              <View style={[styles.swatch, { backgroundColor: detail.hex ?? colors.transparent, borderColor: detail.hex ?? colors.border }]} />
              <Text style={styles.paintTitle}>{paintName(detail.name_ja, detail.name_en)}</Text>
              <Info label={t('brand')} value={brandLabel(detail.brand)} styles={styles} />
              <Info label={t('series')} value={seriesLabel(detail.series, detail.series_en)} styles={styles} />
              <Info label={t('code')} value={detail.code} styles={styles} />
              <Info label={t('hex')} value={displayHex} styles={styles} />
              <Info label={t('paintType')} value={paintTypeLabel(detail.paint_type)} styles={styles} />
              <Info label={t('gloss')} value={glossLabel(detail.gloss)} styles={styles} />

              {isInventory && (
                <View style={styles.field}>
                  <Text style={styles.label}>{t('box')}</Text>
                  <View style={styles.chipRow}>
                    {boxes.map((b) => optionChip(String(b.id), selectedBoxId === b.id, b.name, () => setSelectedBoxId(b.id), styles))}
                  </View>
                </View>
              )}

              <View style={styles.actionRow}>
                <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={addToInventory}>
                  <Text style={styles.primaryButtonText}>{t('addThisColor')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => setIsEditing(true)}>
                  <Text style={styles.buttonText}>{t('editPaint')}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              <EditField label={t('name')} value={nameJa} onChangeText={setNameJa} styles={styles} />
              {masterLine(nameJa, master?.name_ja)}

              {isManual ? (
                <>
                  <EditField label={t('brand')} value={brand} onChangeText={setBrand} styles={styles} />
                  <EditField label={t('series')} value={series} onChangeText={setSeries} styles={styles} />
                  <EditField label={t('code')} value={code} onChangeText={setCode} styles={styles} />
                </>
              ) : (
                <>
                  <ReadonlyField label={t('brand')} value={brandLabel(detail.brand)} styles={styles} />
                  <ReadonlyField label={t('series')} value={seriesLabel(detail.series, detail.series_en)} styles={styles} />
                  <ReadonlyField label={t('code')} value={detail.code} styles={styles} />
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

              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.button} onPress={cancelEdit}>
                  <Text style={styles.buttonText}>{t('cancel')}</Text>
                </TouchableOpacity>
                {detail.source === 'catalog' && master ? (
                  <TouchableOpacity style={styles.button} onPress={resetToMaster}>
                    <Text style={styles.buttonText}>{t('reset')}</Text>
                  </TouchableOpacity>
                ) : null}
                {isManual ? (
                  <TouchableOpacity style={[styles.button, styles.deleteButton]} onPress={remove}>
                    <Text style={styles.deleteButtonText}>{t('delete')}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={[styles.button, styles.primaryButton, !canSave && styles.buttonDisabled]} onPress={save} disabled={!canSave}>
                  <Text style={styles.primaryButtonText}>{t('save')}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}

          {toast ? (
            <View style={styles.toast} pointerEvents="none">
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          ) : null}
          <ColorCameraPicker visible={colorPickerVisible} onClose={() => setColorPickerVisible(false)} onPick={setHex} />
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
  paintTitle: { fontSize: 22, fontWeight: 'bold', color: colors.text, marginBottom: spacing.xl },
  infoRow: { paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  infoLabel: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  infoValue: { fontSize: 16, color: colors.text },
  field: { marginBottom: spacing.lg },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  readonly: { borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.sm, padding: 10, color: colors.textFaint, backgroundColor: colors.surfaceAlt },
  hexRow: { flexDirection: 'row', alignItems: 'center' },
  hexInput: { flex: 1 },
  previewSwatch: { marginLeft: spacing.md, width: touch.min, height: touch.min, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  cameraBtn: { marginLeft: spacing.md, width: touch.min, height: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.chip, marginRight: spacing.md, marginBottom: spacing.md },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textSecondary },
  chipTextOn: { color: colors.onPrimary, fontWeight: 'bold' },
  sectionGap: { marginTop: spacing.lg },
  masterText: { color: colors.textFaint, fontSize: 12, marginTop: -spacing.md, marginBottom: spacing.lg },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xl },
  button: { minHeight: touch.min, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { backgroundColor: colors.primary, borderColor: colors.primary },
  buttonDisabled: { backgroundColor: colors.primaryDisabled, borderColor: colors.primaryDisabled },
  deleteButton: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  buttonText: { color: colors.text, fontWeight: 'bold' },
  primaryButtonText: { color: colors.onPrimary, fontWeight: 'bold' },
  deleteButtonText: { color: colors.danger, fontWeight: 'bold' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
  toast: { position: 'absolute', left: spacing.xxl, right: spacing.xxl, bottom: 32, backgroundColor: 'rgba(0,0,0,0.82)', borderRadius: 20, paddingVertical: 10, paddingHorizontal: spacing.xl, alignItems: 'center' },
  toastText: { color: colors.onPrimary, fontSize: 14 },
});
