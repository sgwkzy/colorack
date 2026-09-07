// components/PaintFormModal.tsx
// 手動塗料(source='manual')の新規追加・編集フォーム。カラーコードは任意。
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { IconX } from '@tabler/icons-react-native';
import { catalogCode, getDB, updateManualPaint } from '../lib/db';
import { t, useLocale } from '../lib/i18n';
import { isDuplicateCatalogCodeError, validateManualPaint } from '../lib/manualPaint';
import { useTheme, lightColors, spacing, touch } from '../lib/theme';
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

export interface PaintFormValues {
  nameJa: string;
  nameEn: string;
  brand: string;
  series: string;
  code: string;
  hex: string;
  paintType: string | null;
  gloss: string | null;
}

export function isPaintFormDirty(current: PaintFormValues, initial: PaintFormValues): boolean {
  return current.nameJa !== initial.nameJa || current.nameEn !== initial.nameEn
    || current.brand !== initial.brand || current.series !== initial.series
    || current.code !== initial.code || current.hex !== initial.hex
    || current.paintType !== initial.paintType || current.gloss !== initial.gloss;
}

function valuesFromPaint(paint: EditablePaint | null): PaintFormValues {
  return {
    nameJa: paint?.name_ja ?? '',
    nameEn: paint?.name_en ?? '',
    brand: paint?.brand ?? '',
    series: paint?.series ?? '',
    code: paint?.code ?? '',
    hex: paint?.hex ?? '',
    paintType: paint?.paint_type ?? null,
    gloss: paint?.gloss ?? null,
  };
}

export default function PaintFormModal({ visible, paint, onClose, onSaved }: Props) {
  useLocale();
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
  const [busy, setBusy] = useState(false);
  const canSave = (nameJa.trim() !== '' || nameEn.trim() !== '') && brand.trim() !== '' && series.trim() !== '';
  const initialRef = useRef<PaintFormValues>(valuesFromPaint(paint));
  const savingRef = useRef(false);
  const currentValues: PaintFormValues = { nameJa, nameEn, brand, series, code, hex, paintType, gloss };
  const dirty = isPaintFormDirty(currentValues, initialRef.current);

  // 開くたびに対象塗料(または空)へ同期。
  useLayoutEffect(() => {
    if (!visible) return;
    const initial = valuesFromPaint(paint);
    initialRef.current = initial;
    setNameJa(initial.nameJa);
    setNameEn(initial.nameEn);
    setBrand(initial.brand);
    setSeries(initial.series);
    setCode(initial.code);
    setHex(initial.hex);
    setPaintType(initial.paintType);
    setGloss(initial.gloss);
    setColorPickerVisible(false);
  }, [visible, paint]);

  const save = async () => {
    if (busy || savingRef.current) return;
    const pairedNameJa = nameJa.trim() || nameEn.trim();
    const pairedNameEn = nameEn.trim() || nameJa.trim();
    const normalized = validateManualPaint({ nameJa: pairedNameJa, brand, series, code, hex, gloss, paintType });
    if (!normalized) return;
    savingRef.current = true;
    setBusy(true);
    try {
      const db = getDB();
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
      initialRef.current = currentValues;
      onSaved();
      onClose();
    } catch (error) {
      console.error('PaintFormModal: failed to save paint', error);
      Alert.alert(t('error'), isDuplicateCatalogCodeError(error) ? t('duplicateCodeError') : t('saveFailed'));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const requestClose = useCallback(() => {
    if (!visible || busy || savingRef.current) return;
    if (!dirty) { onClose(); return; }
    Alert.alert(t('discardChangesConfirm'), '', [
      { text: t('cancel'), style: 'cancel' },
      { text: t('discard'), style: 'destructive', onPress: onClose },
    ]);
  }, [busy, dirty, onClose, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={requestClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={requestClose} enabled={!busy}>
            <View style={styles.header}>
              <Text style={styles.title}>{paint ? t('editPaint') : t('newPaint')}</Text>
              <TouchableOpacity
                onPress={requestClose}
                disabled={busy}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('close')}
                accessibilityState={{ disabled: busy, busy }}
              >
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>
          <SwipeDownScrollView onClose={requestClose} closeEnabled={!busy} style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
            <PaintFormFields
              fields={[
                { label: t('nameJa') + '*', value: nameJa, set: setNameJa },
                { label: t('nameEn'), value: nameEn, set: setNameEn },
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
            style={[styles.btn, (!canSave || busy) && styles.btnDisabled]}
            onPress={save}
            disabled={!canSave || busy}
            accessibilityRole="button"
            accessibilityLabel={t('save')}
            accessibilityState={{ disabled: !canSave || busy, busy }}
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
  btn: { backgroundColor: colors.primary, minHeight: touch.min, padding: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { backgroundColor: colors.primaryDisabled },
  btnText: { color: colors.onPrimary, fontSize: 16, fontWeight: 'bold' },
});
