// components/AddPaint/ManualEntry.tsx
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import ColorCameraPicker from '../ColorCameraPicker';
import { catalogCode, getDB, PaintStatus } from '../../lib/db';
import { t } from '../../lib/i18n';
import { validateManualPaint } from '../../lib/manualPaint';
import { useTheme, lightColors, radius, spacing } from '../../lib/theme';
import PaintFormFields, { optionChip } from '../PaintFormFields';
import SwipeDownScrollView from '../SwipeDownScrollView';

interface Paint {
  id: number;
  name_ja: string;
  name_en: string;
  brand: string;
  hex: string;
}

interface Props {
  onSelect: (paint: Paint, opts?: { status?: PaintStatus; boxId?: number | null }) => void;
  // 在庫コンテキスト(保管箱の＋)なら在庫ステータス/ボックスの選択欄を出す。
  showInventory?: boolean;
  defaultBoxId?: number | null;
  onRequestClose?: () => void;
}

const STATUS_OPTIONS: { key: PaintStatus; label: string }[] = [
  { key: 'owned', label: 'statusOwned' },
  { key: 'in_use', label: 'statusInUse' },
  { key: 'used_up', label: 'statusUsedUp' },
];

export default function ManualEntry({ onSelect, showInventory = false, defaultBoxId = null, onRequestClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [nameJa, setNameJa] = useState('');
  const [brand, setBrand] = useState('');
  const [series, setSeries] = useState('');
  const [code, setCode] = useState('');
  const [hex, setHex] = useState('');
  const [paintType, setPaintType] = useState<string | null>(null);
  const [gloss, setGloss] = useState<string | null>(null);
  const [status, setStatus] = useState<PaintStatus>('owned');
  const [boxId, setBoxId] = useState<number | null>(defaultBoxId);
  const [boxes, setBoxes] = useState<{ id: number; name: string }[]>([]);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const canSave = nameJa.trim() !== '' && brand.trim() !== '' && series.trim() !== '';

  useEffect(() => {
    if (!showInventory) return;
    getDB().getAllAsync<{ id: number; name: string }>('SELECT id, name FROM boxes ORDER BY sort_order, id')
      .then(setBoxes);
  }, [showInventory]);

  const save = async () => {
    const normalized = validateManualPaint({ nameJa, brand, series, code, hex, gloss, paintType });
    if (!normalized) return;
    const db = getDB();
    try {
      const result = await db.runAsync(
        'INSERT INTO catalog_paints (catalog_code, brand, series, code, name_ja, name_en, hex, r, g, b, l, a_star, b_star, gloss, paint_type, source)'
        + ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [catalogCode(normalized.brand, normalized.series, normalized.code), normalized.brand, normalized.series, normalized.code, normalized.nameJa, '', normalized.normalizedHex,
         normalized.rgb?.r ?? null, normalized.rgb?.g ?? null, normalized.rgb?.b ?? null,
         normalized.lab?.L ?? null, normalized.lab?.a ?? null, normalized.lab?.b ?? null,
         normalized.gloss, normalized.paintType, 'manual']
      );
      onSelect(
        { id: result.lastInsertRowId as number, name_ja: normalized.nameJa, name_en: '', brand: normalized.brand, hex: normalized.normalizedHex ?? '' },
        showInventory ? { status, boxId } : undefined
      );
    } catch {
      Alert.alert('入力エラー', '同じブランド内に同じ品番が既に登録されています。別の品番にしてください。');
    }
  };

  const chip = optionChip;

  return (
    <SwipeDownScrollView onClose={onRequestClose ?? (() => {})} style={styles.container} contentContainerStyle={{ padding: 16, flexGrow: 1 }} alwaysBounceVertical keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
      <PaintFormFields
        fields={[
          { label: t('name') + '*', value: nameJa, set: setNameJa },
          { label: t('brand') + '*', value: brand, set: setBrand },
          { label: t('series') + '*', value: series, set: setSeries },
          { label: t('code'), value: code, set: setCode },
        ]}
        hex={hex}
        setHex={setHex}
        paintType={paintType}
        setPaintType={setPaintType}
        gloss={gloss}
        setGloss={setGloss}
        onOpenCamera={() => setColorPickerVisible(true)}
        swatch
      />

      {/* 在庫ステータス/ボックス(保管箱の＋からの登録時のみ) */}
      {showInventory && (
        <>
          <Text style={[styles.label, { marginTop: 12 }]}>{t('status')}</Text>
          <View style={styles.chipRow}>
            {STATUS_OPTIONS.map((s) => chip(s.key, status === s.key, t(s.label), () => setStatus(s.key), styles))}
          </View>

          <Text style={[styles.label, { marginTop: 12 }]}>{t('box')}</Text>
          <View style={styles.chipRow}>
            {boxes.map((b) => chip(String(b.id), boxId === b.id, b.name, () => setBoxId(b.id), styles))}
          </View>
        </>
      )}

      <TouchableOpacity
        style={[styles.btn, !canSave && styles.btnDisabled]}
        onPress={save}
        disabled={!canSave}
      >
        <Text style={styles.btnText}>{t('save')}</Text>
      </TouchableOpacity>
      <ColorCameraPicker
        visible={colorPickerVisible}
        onClose={() => setColorPickerVisible(false)}
        onPick={setHex}
      />
    </SwipeDownScrollView>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.chip, marginRight: spacing.md, marginBottom: spacing.md },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textSecondary },
  chipTextOn: { color: colors.onPrimary, fontWeight: 'bold' },
  btn: { backgroundColor: colors.primary, padding: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.md },
  btnDisabled: { backgroundColor: colors.primaryDisabled },
  btnText: { color: colors.onPrimary, fontSize: 16, fontWeight: 'bold' },
});
