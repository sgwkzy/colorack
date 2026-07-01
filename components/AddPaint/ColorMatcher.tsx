// components/AddPaint/ColorMatcher.tsx
import { useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { IconCamera, IconPlus } from '@tabler/icons-react-native';
import ClearableInput from '../ClearableInput';
import ColorCameraPicker from '../ColorCameraPicker';
import { getDB } from '../../lib/db';
import { rgb_to_lab, delta_e, hex_to_rgb } from '../../lib/color';
import { t } from '../../lib/i18n';
import { brandLabel } from '../../lib/brands';
import { glossLabel } from '../../lib/gloss';
import { paintName } from '../../lib/paintLabel';
import TypeIcon from '../TypeIcon';

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
          <IconCamera color="#4a90d9" size={22} />
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
          <View style={[styles.row, { borderLeftColor: item.hex, borderLeftWidth: 8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{paintName(item.name_ja, item.name_en)}{item.code ? <Text style={styles.code}>  {item.code}</Text> : null}</Text>
              <View style={styles.subRow}>
                <TypeIcon paintType={item.paint_type} />
                <Text style={styles.sub}>{brandLabel(item.brand)}{item.gloss ? ` · ${glossLabel(item.gloss)}` : ''} · ΔE={item.de.toFixed(1)}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.addBtn} onPress={() => onSelect(item)}>
              <IconPlus color="#fff" size={22} />
            </TouchableOpacity>
          </View>
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
  container: { flex: 1, padding: 12 },
  label: { fontSize: 14, fontWeight: 'bold', marginBottom: 8, marginTop: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12 },
  hexInput: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, marginRight: 6 },
  cameraBtn: { marginRight: 6, width: 44, height: 44, borderWidth: 1, borderColor: '#ccc', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  btn: { backgroundColor: '#4a90d9', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6 },
  btnText: { color: '#fff', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#4a90d9', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  name: { fontSize: 14 },
  code: { fontSize: 11, color: '#999' },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  sub: { fontSize: 11, color: '#666' },
});
