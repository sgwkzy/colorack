// components/AddPaint/ManualEntry.tsx
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { IconCamera } from '@tabler/icons-react-native';
import ClearableInput from '../ClearableInput';
import ColorCameraPicker from '../ColorCameraPicker';
import { getDB, PaintStatus } from '../../lib/db';
import { t } from '../../lib/i18n';
import { rgb_to_lab, hex_to_rgb } from '../../lib/color';
import { paintTypeLabel } from '../../lib/paintType';
import { glossLabel } from '../../lib/gloss';

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
}

const TYPE_OPTIONS = ['ラッカー塗料', '水性アクリル塗料', 'エナメル塗料', 'エマルジョン塗料'];
const GLOSS_OPTIONS = ['光沢', '半光沢', 'つや消し', 'メタリック', 'パール'];
const STATUS_OPTIONS: { key: PaintStatus; label: string }[] = [
  { key: 'owned', label: 'statusOwned' },
  { key: 'in_use', label: 'statusInUse' },
  { key: 'used_up', label: 'statusUsedUp' },
];

export default function ManualEntry({ onSelect, showInventory = false, defaultBoxId = null }: Props) {
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
    getDB().getAllAsync<{ id: number; name: string }>('SELECT id, name FROM boxes ORDER BY id')
      .then(setBoxes);
  }, [showInventory]);

  const save = async () => {
    if (!nameJa.trim() || !brand.trim() || !series.trim()) {
      Alert.alert('入力エラー', '名前・ブランド・シリーズは必須です'); return;
    }
    // カラーコードは任意。入力があるときだけ検証して rgb/lab を計算する。
    let normalizedHex: string | null = null;
    let rgb: { r: number; g: number; b: number } | null = null;
    let lab: { L: number; a: number; b: number } | null = null;
    if (hex.trim()) {
      rgb = hex_to_rgb(hex);
      if (!rgb) { Alert.alert('入力エラー', 'カラーコードの形式が不正です (#RRGGBB)'); return; }
      lab = rgb_to_lab(rgb.r, rgb.g, rgb.b);
      normalizedHex = `#${hex.replace('#', '')}`;
    }
    const finalCode = code.trim() || `MANUAL_${Date.now()}`;
    const db = getDB();
    try {
      const result = await db.runAsync(
        'INSERT INTO catalog_paints (brand, series, code, name_ja, name_en, hex, r, g, b, l, a_star, b_star, gloss, paint_type, source)'
        + ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [brand.trim(), series.trim(), finalCode, nameJa.trim(), '', normalizedHex,
         rgb?.r ?? null, rgb?.g ?? null, rgb?.b ?? null, lab?.L ?? null, lab?.a ?? null, lab?.b ?? null, gloss, paintType, 'manual']
      );
      onSelect(
        { id: result.lastInsertRowId as number, name_ja: nameJa.trim(), name_en: '', brand: brand.trim(), hex: normalizedHex ?? '' },
        showInventory ? { status, boxId } : undefined
      );
    } catch {
      Alert.alert('入力エラー', '品番が重複しています。別の品番にしてください。');
    }
  };

  const chip = (value: string, selected: boolean, label: string, onPress: () => void) => (
    <TouchableOpacity key={value} style={[styles.chip, selected && styles.chipOn]} onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
      {[
        { label: t('name') + '*', value: nameJa, set: setNameJa },
        { label: t('brand') + '*', value: brand, set: setBrand },
        { label: t('series') + '*', value: series, set: setSeries },
        { label: t('code'), value: code, set: setCode },
      ].map(({ label, value, set }) => (
        <View key={label} style={styles.field}>
          <Text style={styles.label}>{label}</Text>
          <ClearableInput style={styles.input} value={value} onChangeText={set} autoCapitalize="none" />
        </View>
      ))}
      <View style={styles.field}>
        <Text style={styles.label}>{t('hex') + ' (#RRGGBB)'}</Text>
        <View style={styles.hexRow}>
          <ClearableInput style={[styles.input, styles.hexInput]} value={hex} onChangeText={setHex} autoCapitalize="none" />
          {hex.match(/^#?[0-9a-fA-F]{6}$/) && (
            <View style={[styles.previewSwatch, { backgroundColor: `#${hex.replace('#', '')}` }]} />
          )}
          <TouchableOpacity
            style={styles.cameraBtn}
            onPress={() => setColorPickerVisible(true)}
            accessibilityLabel="カメラで色を取得"
          >
            <IconCamera color="#4a90d9" size={22} />
          </TouchableOpacity>
        </View>
      </View>

      {/* 塗料種別 */}
      <Text style={styles.label}>{t('paintType')}</Text>
      <View style={styles.chipRow}>
        {TYPE_OPTIONS.map((v) => chip(v, paintType === v, paintTypeLabel(v),
          () => setPaintType(paintType === v ? null : v)))}
      </View>

      {/* つや */}
      <Text style={[styles.label, { marginTop: 12 }]}>{t('gloss')}</Text>
      <View style={styles.chipRow}>
        {GLOSS_OPTIONS.map((v) => chip(v, gloss === v, glossLabel(v),
          () => setGloss(gloss === v ? null : v)))}
      </View>

      {/* 在庫ステータス/ボックス(保管箱の＋からの登録時のみ) */}
      {showInventory && (
        <>
          <Text style={[styles.label, { marginTop: 12 }]}>{t('status')}</Text>
          <View style={styles.chipRow}>
            {STATUS_OPTIONS.map((s) => chip(s.key, status === s.key, t(s.label), () => setStatus(s.key)))}
          </View>

          <Text style={[styles.label, { marginTop: 12 }]}>{t('box')}</Text>
          <View style={styles.chipRow}>
            {boxes.map((b) => chip(String(b.id), boxId === b.id, b.name, () => setBoxId(b.id)))}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  field: { marginBottom: 12 },
  label: { fontSize: 12, color: '#666', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10 },
  hexRow: { flexDirection: 'row', alignItems: 'center' },
  hexInput: { flex: 1 },
  previewSwatch: { marginLeft: 8, width: 44, height: 44, borderRadius: 6, borderWidth: 1, borderColor: '#ccc' },
  cameraBtn: { marginLeft: 8, width: 44, height: 44, borderWidth: 1, borderColor: '#ccc', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: '#f0f0f0', marginRight: 8, marginBottom: 8 },
  chipOn: { backgroundColor: '#4a90d9' },
  chipText: { fontSize: 13, color: '#555' },
  chipTextOn: { color: '#fff', fontWeight: 'bold' },
  btn: { backgroundColor: '#4a90d9', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  btnDisabled: { backgroundColor: '#b7cde6' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
