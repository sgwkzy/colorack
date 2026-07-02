// components/AddPaint/ColorMatcher.tsx
import { useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { IconCamera, IconPlus } from '@tabler/icons-react-native';
import ClearableInput from '../ClearableInput';
import ColorCameraPicker from '../ColorCameraPicker';
import { getDB } from '../../lib/db';
import { rgb_to_lab, delta_e, hex_to_rgb } from '../../lib/color';
import { t } from '../../lib/i18n';
import { colors, radius, spacing, touch } from '../../lib/theme';
import PaintRow from '../PaintRow';

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
}

export default function ColorMatcher({ onSelect }: Props) {
  const [hex, setHex] = useState('');
  const [results, setResults] = useState<(Paint & { de: number })[]>([]);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);

  const search = async (ri: number, gi: number, bi: number) => {
    const targetLab = rgb_to_lab(ri, gi, bi);
    const db = getDB();
    const all = await db.getAllAsync<Paint>(
      'SELECT id, name_ja, name_en, code, brand, hex, gloss, paint_type, r, g, b, l, a_star, b_star FROM catalog_paints WHERE l IS NOT NULL'
    );
    const scored = all
      .map((p) => ({ ...p, de: delta_e(targetLab, { L: p.l, a: p.a_star, b: p.b_star }) }))
      .sort((a, b) => a.de - b.de)
      .slice(0, 10);
    setResults(scored);
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
        <TouchableOpacity style={styles.btn} onPress={matchHex}>
          <Text style={styles.btnText}>{t('colorMatch')}</Text>
        </TouchableOpacity>
      </View>

      {results.length > 0 && <Text style={styles.label}>{t('topMatches')}</Text>}
      <FlatList
        data={results}
        keyExtractor={(item) => String(item.id)}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <PaintRow paint={item} compact subSuffix={` · ΔE=${item.de.toFixed(1)}`}>
            <TouchableOpacity style={styles.addBtn} onPress={() => onSelect(item)}>
              <IconPlus color={colors.onPrimary} size={22} />
            </TouchableOpacity>
          </PaintRow>
        )}
      />
      <ColorCameraPicker
        visible={colorPickerVisible}
        onClose={() => setColorPickerVisible(false)}
        onPick={setHex}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  label: { fontSize: 14, fontWeight: 'bold', marginBottom: spacing.md, marginTop: spacing.xs },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing.lg },
  hexInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md, marginRight: spacing.sm },
  cameraBtn: { marginRight: spacing.sm, width: touch.min, height: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  btn: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.sm, minHeight: touch.min, justifyContent: 'center' },
  btnText: { color: colors.onPrimary, fontSize: 13 },
  addBtn: { width: touch.min, height: touch.min, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
});
