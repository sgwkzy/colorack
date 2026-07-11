// components/AddPaint/ColorMatcher.tsx
import { useEffect, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { IconCamera, IconPlus, IconChevronDown, IconChevronUp } from '@tabler/icons-react-native';
import ClearableInput from '../ClearableInput';
import ColorCameraPicker from '../ColorCameraPicker';
import { getDB, getOwnedCountMap } from '../../lib/db';
import { rgb_to_lab, delta_e, hex_to_rgb } from '../../lib/color';
import { glossLabel } from '../../lib/gloss';
import { paintTypeLabel } from '../../lib/paintType';
import { t } from '../../lib/i18n';
import { useTheme, lightColors, radius, spacing, touch } from '../../lib/theme';
import PaintRow from '../PaintRow';
import { isValidHex } from '../PaintFormFields';
import { swipeDownCloseProps } from '../SwipeDownScrollView';

interface Paint {
  id: number;
  name_ja: string;
  name_en: string | null;
  code: string;
  brand: string;
  hex: string;
  gloss: string | null;
  paint_type: string | null;
  r: number;
  g: number;
  b: number;
  l: number;
  a_star: number;
  b_star: number;
}

interface Props {
  onSelect: (paint: Paint) => void;
  onSelectView: (paint: Paint) => void;
  // 一覧を最上部からさらに引っ張って離した時に親モーダルを閉じる
  onRequestClose?: () => void;
}

export default function ColorMatcher({ onSelect, onSelectView, onRequestClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const closeProps = onRequestClose ? swipeDownCloseProps(onRequestClose) : undefined;
  const [hex, setHex] = useState('');
  const [results, setResults] = useState<(Paint & { de: number })[]>([]);
  const [ownedCounts, setOwnedCounts] = useState<Map<number, number>>(new Map());
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [glossOptions, setGlossOptions] = useState<string[]>([]);
  const [selectedGloss, setSelectedGloss] = useState<string[]>([]);
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [glossOpen, setGlossOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const canMatchHex = isValidHex(hex);

  useEffect(() => {
    getDB().getAllAsync<{ gloss: string }>('SELECT DISTINCT gloss FROM catalog_paints WHERE gloss IS NOT NULL ORDER BY gloss')
      .then((rows) => setGlossOptions(rows.map((r) => r.gloss)));
    getDB().getAllAsync<{ paint_type: string }>('SELECT DISTINCT paint_type FROM catalog_paints WHERE paint_type IS NOT NULL ORDER BY paint_type')
      .then((rows) => setTypeOptions(rows.map((r) => r.paint_type)));
  }, []);

  const toggleGloss = (value: string) => {
    setSelectedGloss((current) => (
      current.includes(value) ? current.filter((g) => g !== value) : [...current, value]
    ));
  };

  const toggleType = (value: string) => {
    setSelectedTypes((current) => (
      current.includes(value) ? current.filter((p) => p !== value) : [...current, value]
    ));
  };

  const search = async (ri: number, gi: number, bi: number) => {
    const targetLab = rgb_to_lab(ri, gi, bi);
    const db = getDB();
    const where = ['l IS NOT NULL'];
    const args: string[] = [];
    if (selectedGloss.length > 0) {
      where.push(`gloss IN (${selectedGloss.map(() => '?').join(',')})`);
      args.push(...selectedGloss);
    }
    if (selectedTypes.length > 0) {
      where.push(`paint_type IN (${selectedTypes.map(() => '?').join(',')})`);
      args.push(...selectedTypes);
    }
    const [all, ownedMap] = await Promise.all([
      db.getAllAsync<Paint>(
        'SELECT id, name_ja, name_en, code, brand, hex, gloss, paint_type, r, g, b, l, a_star, b_star FROM catalog_paints WHERE ' + where.join(' AND '),
        args
      ),
      getOwnedCountMap(),
    ]);
    const scored = all
      .map((p) => ({ ...p, de: delta_e(targetLab, { L: p.l, a: p.a_star, b: p.b_star }) }))
      .sort((a, b) => a.de - b.de)
      .slice(0, 10);
    setResults(scored);
    setOwnedCounts(ownedMap);
  };

  const matchHex = () => {
    const rgb = hex_to_rgb(hex);
    if (!rgb) return;
    search(rgb.r, rgb.g, rgb.b);
  };

  return (
    <View style={styles.container}>
      {/* HEX */}
      <Text style={styles.label}>{t('enterHex')}</Text>
      <View style={styles.inputRow}>
        <View style={[styles.targetSwatch, { backgroundColor: canMatchHex ? hex : colors.chip }]} />
        <ClearableInput
          style={styles.hexInput}
          placeholder="#1a2b3c"
          autoCapitalize="none"
          value={hex}
          onChangeText={setHex}
          maxLength={7}
        />
        <TouchableOpacity
          style={styles.cameraBtn}
          onPress={() => setColorPickerVisible(true)}
          accessibilityLabel="カメラで色を取得"
        >
          <IconCamera color={colors.primary} size={22} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, !canMatchHex && styles.btnDisabled]}
          onPress={matchHex}
          disabled={!canMatchHex}
        >
          <Text style={styles.btnText}>{t('colorMatch')}</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.dropdown} onPress={() => setGlossOpen((o) => !o)}>
        <Text style={styles.dropdownLabel}>
          {t('gloss')}{selectedGloss.length ? ` (${selectedGloss.length})` : ''}
        </Text>
        {glossOpen
          ? <IconChevronUp size={16} color={colors.textFaint} />
          : <IconChevronDown size={16} color={colors.textFaint} />}
      </TouchableOpacity>
      {glossOpen && (
        <View style={styles.chipRow}>
          {glossOptions.map((g) => {
            const selected = selectedGloss.includes(g);
            return (
              <TouchableOpacity
                key={g}
                style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.chip }]}
                onPress={() => toggleGloss(g)}
              >
                <Text style={[styles.chipText, { color: selected ? colors.onPrimary : colors.text }]}>{glossLabel(g)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <TouchableOpacity style={styles.dropdown} onPress={() => setTypeOpen((o) => !o)}>
        <Text style={styles.dropdownLabel}>
          {t('paintType')}{selectedTypes.length ? ` (${selectedTypes.length})` : ''}
        </Text>
        {typeOpen
          ? <IconChevronUp size={16} color={colors.textFaint} />
          : <IconChevronDown size={16} color={colors.textFaint} />}
      </TouchableOpacity>
      {typeOpen && (
        <View style={styles.chipRow}>
          {typeOptions.map((p) => {
            const selected = selectedTypes.includes(p);
            return (
              <TouchableOpacity
                key={p}
                style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.chip }]}
                onPress={() => toggleType(p)}
              >
                <Text style={[styles.chipText, { color: selected ? colors.onPrimary : colors.text }]}>{paintTypeLabel(p)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {results.length > 0 && <Text style={styles.label}>{t('topMatches')}</Text>}
      <FlatList
        style={{ flex: 1 }}
        data={results}
        {...closeProps}
        contentContainerStyle={{ flexGrow: 1 }}
        alwaysBounceVertical
        keyExtractor={(item) => String(item.id)}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.7} onPress={() => onSelectView(item)}>
            <PaintRow paint={item} compact subSuffix={` · ΔE=${item.de.toFixed(1)}`} ownedCount={ownedCounts.get(item.id) ?? 0}>
              <TouchableOpacity style={styles.addBtn} onPress={() => onSelect(item)}>
                <IconPlus color={colors.onPrimary} size={22} />
              </TouchableOpacity>
            </PaintRow>
          </TouchableOpacity>
        )}
      />
      <ColorCameraPicker
        visible={colorPickerVisible}
        onClose={() => setColorPickerVisible(false)}
        onPick={(picked) => {
          setHex(picked);
          const rgb = hex_to_rgb(picked);
          if (rgb) search(rgb.r, rgb.g, rgb.b);
        }}
      />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  label: { fontSize: 14, fontWeight: 'bold', marginBottom: spacing.md, marginTop: spacing.xs, color: colors.text },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing.lg },
  targetSwatch: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm },
  hexInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md, marginRight: spacing.sm, color: colors.text },
  cameraBtn: { marginRight: spacing.sm, width: touch.min, height: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  btn: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.sm, minHeight: touch.min, justifyContent: 'center' },
  btnDisabled: { backgroundColor: colors.primaryDisabled },
  btnText: { color: colors.onPrimary, fontSize: 13 },
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, borderTopWidth: 1, borderColor: colors.borderLight },
  dropdownLabel: { fontSize: 14, color: colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md, marginBottom: spacing.lg },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, marginRight: spacing.md, marginBottom: spacing.md },
  chipText: { fontSize: 13 },
  addBtn: { width: touch.min, height: touch.min, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
});
