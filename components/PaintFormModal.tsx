// components/PaintFormModal.tsx
// 手動塗料(source='manual')の新規追加・編集フォーム。カラーコードは任意。
import { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { IconCamera, IconX } from '@tabler/icons-react-native';
import { getDB } from '../lib/db';
import { t } from '../lib/i18n';
import { rgb_to_lab, hex_to_rgb } from '../lib/color';
import { paintTypeLabel } from '../lib/paintType';
import { glossLabel } from '../lib/gloss';
import ClearableInput from './ClearableInput';
import ColorCameraPicker from './ColorCameraPicker';

export interface EditablePaint {
  id: number;
  name_ja: string;
  brand: string;
  series: string;
  code: string;
  hex: string | null;
  gloss: string | null;
  paint_type: string | null;
}

interface Props {
  visible: boolean;
  paint: EditablePaint | null; // null=新規, あり=編集
  onClose: () => void;
  onSaved: () => void;
}

const TYPE_OPTIONS = ['ラッカー塗料', '水性アクリル塗料', 'エナメル塗料', 'エマルジョン塗料'];
const GLOSS_OPTIONS = ['光沢', '半光沢', 'つや消し', 'メタリック', 'パール'];

export default function PaintFormModal({ visible, paint, onClose, onSaved }: Props) {
  const [nameJa, setNameJa] = useState('');
  const [brand, setBrand] = useState('');
  const [series, setSeries] = useState('');
  const [code, setCode] = useState('');
  const [hex, setHex] = useState('');
  const [paintType, setPaintType] = useState<string | null>(null);
  const [gloss, setGloss] = useState<string | null>(null);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const canSave = nameJa.trim() !== '' && brand.trim() !== '' && series.trim() !== '';

  // 開くたびに対象塗料(または空)へ同期。
  useEffect(() => {
    if (!visible) return;
    setNameJa(paint?.name_ja ?? '');
    setBrand(paint?.brand ?? '');
    setSeries(paint?.series ?? '');
    setCode(paint?.code ?? '');
    setHex(paint?.hex ?? '');
    setPaintType(paint?.paint_type ?? null);
    setGloss(paint?.gloss ?? null);
  }, [visible, paint]);

  const save = async () => {
    if (!nameJa.trim() || !brand.trim() || !series.trim()) {
      Alert.alert('入力エラー', '名前・ブランド・シリーズは必須です'); return;
    }
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
      if (paint) {
        await db.runAsync(
          'UPDATE catalog_paints SET brand=?, series=?, code=?, name_ja=?, hex=?, r=?, g=?, b=?, l=?, a_star=?, b_star=?, gloss=?, paint_type=? WHERE id=?',
          [brand.trim(), series.trim(), finalCode, nameJa.trim(), normalizedHex,
           rgb?.r ?? null, rgb?.g ?? null, rgb?.b ?? null, lab?.L ?? null, lab?.a ?? null, lab?.b ?? null,
           gloss, paintType, paint.id]
        );
      } else {
        await db.runAsync(
          'INSERT INTO catalog_paints (brand, series, code, name_ja, name_en, hex, r, g, b, l, a_star, b_star, gloss, paint_type, source)'
          + ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [brand.trim(), series.trim(), finalCode, nameJa.trim(), '', normalizedHex,
           rgb?.r ?? null, rgb?.g ?? null, rgb?.b ?? null, lab?.L ?? null, lab?.a ?? null, lab?.b ?? null,
           gloss, paintType, 'manual']
        );
      }
      onSaved();
      onClose();
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
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Text style={styles.title}>{paint ? t('editPaint') : t('newPaint')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <IconX color="#333" size={24} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
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
                <TouchableOpacity
                  style={styles.cameraBtn}
                  onPress={() => setColorPickerVisible(true)}
                  accessibilityLabel="カメラで色を取得"
                >
                  <IconCamera color="#4a90d9" size={22} />
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.label}>{t('paintType')}</Text>
            <View style={styles.chipRow}>
              {TYPE_OPTIONS.map((v) => chip(v, paintType === v, paintTypeLabel(v),
                () => setPaintType(paintType === v ? null : v)))}
            </View>

            <Text style={[styles.label, { marginTop: 12 }]}>{t('gloss')}</Text>
            <View style={styles.chipRow}>
              {GLOSS_OPTIONS.map((v) => chip(v, gloss === v, glossLabel(v),
                () => setGloss(gloss === v ? null : v)))}
            </View>

            {hex.match(/^#?[0-9a-fA-F]{6}$/) && (
              <View style={[styles.preview, { backgroundColor: `#${hex.replace('#', '')}` }]} />
            )}
          </ScrollView>
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
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  title: { fontSize: 18, fontWeight: 'bold' },
  field: { marginBottom: 12 },
  label: { fontSize: 12, color: '#666', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10 },
  hexRow: { flexDirection: 'row', alignItems: 'center' },
  hexInput: { flex: 1 },
  cameraBtn: { marginLeft: 8, width: 44, height: 44, borderWidth: 1, borderColor: '#ccc', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: '#f0f0f0', marginRight: 8, marginBottom: 8 },
  chipOn: { backgroundColor: '#4a90d9' },
  chipText: { fontSize: 13, color: '#555' },
  chipTextOn: { color: '#fff', fontWeight: 'bold' },
  preview: { height: 40, borderRadius: 6, marginTop: 12 },
  btn: { backgroundColor: '#4a90d9', padding: 16, alignItems: 'center' },
  btnDisabled: { backgroundColor: '#b7cde6' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
