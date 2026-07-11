// components/PaintFormModal.tsx
// 手動塗料(source='manual')の新規追加・編集フォーム。カラーコードは任意。
import { useEffect, useState, useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { IconX } from '@tabler/icons-react-native';
import { catalogCode, getDB, updateManualPaint } from '../lib/db';
import { t, useLocale } from '../lib/i18n';
import { validateManualPaint } from '../lib/manualPaint';
import { useTheme, lightColors, spacing } from '../lib/theme';
import ColorCameraPicker from './ColorCameraPicker';
import PaintFormFields, { isValidHex } from './PaintFormFields';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';

export interface EditablePaint {
  id: number;
  name_ja: string;
  name_en?: string | null;
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

export default function PaintFormModal({ visible, paint, onClose, onSaved }: Props) {
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [nameJa, setNameJa] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [brand, setBrand] = useState('');
  const [series, setSeries] = useState('');
  const [code, setCode] = useState('');
  const [hex, setHex] = useState('');
  const [paintType, setPaintType] = useState<string | null>(null);
  const [gloss, setGloss] = useState<string | null>(null);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const canSave = (nameJa.trim() !== '' || nameEn.trim() !== '') && brand.trim() !== '' && series.trim() !== '';

  // 開くたびに対象塗料(または空)へ同期。
  useEffect(() => {
    if (!visible) return;
    setNameJa(paint?.name_ja ?? '');
    setNameEn(paint?.name_en ?? '');
    setBrand(paint?.brand ?? '');
    setSeries(paint?.series ?? '');
    setCode(paint?.code ?? '');
    setHex(paint?.hex ?? '');
    setPaintType(paint?.paint_type ?? null);
    setGloss(paint?.gloss ?? null);
  }, [visible, paint]);

  const save = async () => {
    const pairedNameJa = nameJa.trim() || nameEn.trim();
    const pairedNameEn = nameEn.trim() || nameJa.trim();
    const normalized = validateManualPaint({ nameJa: pairedNameJa, brand, series, code, hex, gloss, paintType });
    if (!normalized) return;
    const db = getDB();
    try {
      const catCode = catalogCode(normalized.brand, normalized.series, normalized.code);
      if (paint) {
        await updateManualPaint(paint.id, { nameJa: pairedNameJa, nameEn: pairedNameEn, brand, series, code, hex, gloss, paintType });
      } else {
        await db.runAsync(
          'INSERT INTO catalog_paints (catalog_code, brand, series, code, name_ja, name_en, hex, r, g, b, l, a_star, b_star, gloss, paint_type, source)'
          + ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [catCode, normalized.brand, normalized.series, normalized.code, normalized.nameJa, pairedNameEn, normalized.normalizedHex,
           normalized.rgb?.r ?? null, normalized.rgb?.g ?? null, normalized.rgb?.b ?? null,
           normalized.lab?.L ?? null, normalized.lab?.a ?? null, normalized.lab?.b ?? null,
           normalized.gloss, normalized.paintType, 'manual']
        );
      }
      onSaved();
      onClose();
    } catch {
      Alert.alert('入力エラー', '同じブランド内に同じ品番が既に登録されています。別の品番にしてください。');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={onClose}>
            <View style={styles.header}>
              <Text style={styles.title}>{paint ? t('editPaint') : t('newPaint')}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>
          <SwipeDownScrollView onClose={onClose} style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
            <PaintFormFields
              fields={[
                { label: (locale === 'ja' ? '名前（和名）' : 'Name (Japanese)') + '*', value: nameJa, set: setNameJa },
                { label: locale === 'ja' ? '名前（英名）' : 'Name (English)', value: nameEn, set: setNameEn },
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
            />

            {isValidHex(hex) && (
              <View style={[styles.preview, { backgroundColor: `#${hex.replace('#', '')}` }]} />
            )}
          </SwipeDownScrollView>
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

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  preview: { height: 40, borderRadius: 6, marginTop: spacing.lg },
  btn: { backgroundColor: colors.primary, padding: spacing.xl, alignItems: 'center' },
  btnDisabled: { backgroundColor: colors.primaryDisabled },
  btnText: { color: colors.onPrimary, fontSize: 16, fontWeight: 'bold' },
});
