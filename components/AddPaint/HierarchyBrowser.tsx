// components/AddPaint/HierarchyBrowser.tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { IconPlus } from '@tabler/icons-react-native';
import ClearableInput from '../ClearableInput';
import { getDB } from '../../lib/db';
import { t } from '../../lib/i18n';
import { brandLabel } from '../../lib/brands';
import { glossLabel } from '../../lib/gloss';
import TypeIcon from '../TypeIcon';
import SwipeBack from '../SwipeBack';

interface Paint {
  id: number;
  name_ja: string;
  name_en: string;
  code: string;
  brand: string;
  series: string;
  hex: string;
  gloss: string | null;
  paint_type: string | null;
}

interface Props {
  onSelect: (paint: Paint) => void;
}

// 階層を横断して「すべて」を表す番兵。実データと衝突しない値。
const ALL = 'ALL';

export default function HierarchyBrowser({ onSelect }: Props) {
  const [brands, setBrands] = useState<string[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [seriesList, setSeriesList] = useState<string[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const [paints, setPaints] = useState<Paint[]>([]);
  const [nameFilter, setNameFilter] = useState('');

  useEffect(() => {
    getDB().getAllAsync<{ brand: string }>(
      'SELECT DISTINCT brand FROM catalog_paints ORDER BY brand'
    ).then((rows) => setBrands(rows.map((r) => r.brand)));
  }, []);

  // brand/series が ALL のときはその条件を外して階層下を全件取得。
  const loadPaints = async (brand: string, series: string) => {
    const where: string[] = [];
    const args: string[] = [];
    if (brand !== ALL) { where.push('brand = ?'); args.push(brand); }
    if (series !== ALL) { where.push('series = ?'); args.push(series); }
    const sql = 'SELECT id, name_ja, name_en, code, brand, series, hex, gloss, paint_type FROM catalog_paints'
      + (where.length ? ' WHERE ' + where.join(' AND ') : '')
      + ' ORDER BY name_ja';
    setPaints(await getDB().getAllAsync<Paint>(sql, args));
    setNameFilter('');
  };

  const selectBrand = async (brand: string) => {
    setSelectedBrand(brand);
    setPaints([]);
    if (brand === ALL) { setSelectedSeries(ALL); loadPaints(ALL, ALL); return; }
    setSelectedSeries(null);
    const rows = await getDB().getAllAsync<{ series: string }>(
      'SELECT DISTINCT series FROM catalog_paints WHERE brand = ? ORDER BY series',
      [brand]
    );
    setSeriesList(rows.map((r) => r.series));
  };

  const selectSeries = (series: string) => {
    setSelectedSeries(series);
    loadPaints(selectedBrand!, series);
  };

  // 塗料一覧の戻り先: brand=ALL のときはブランド一覧へ、それ以外はシリーズ一覧へ。
  const backFromPaints = () => {
    if (selectedBrand === ALL) { setSelectedBrand(null); setSelectedSeries(null); }
    else setSelectedSeries(null);
  };

  const q = nameFilter.trim().toLowerCase();
  const shownPaints = q
    ? paints.filter((p) =>
        p.name_ja.toLowerCase().includes(q)
        || (p.name_en ?? '').toLowerCase().includes(q)
        || (p.code ?? '').toLowerCase().includes(q))
    : paints;

  if (!selectedBrand) {
    return (
      <FlatList
        data={[ALL, ...brands]}
        keyExtractor={(b) => b}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.item, item === ALL && styles.allItem]} onPress={() => selectBrand(item)}>
            <Text style={[styles.itemText, item === ALL && styles.allText]}>{item === ALL ? t('all') : brandLabel(item)}</Text>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        )}
      />
    );
  }

  if (!selectedSeries) {
    return (
      <SwipeBack enabled onBack={() => setSelectedBrand(null)}>
        <View style={styles.container}>
          <TouchableOpacity style={styles.back} onPress={() => setSelectedBrand(null)}>
            <Text style={styles.backText}>‹ {brandLabel(selectedBrand)}</Text>
          </TouchableOpacity>
          <FlatList
            data={[ALL, ...seriesList]}
            keyExtractor={(s) => s}
            renderItem={({ item }) => (
              <TouchableOpacity style={[styles.item, item === ALL && styles.allItem]} onPress={() => selectSeries(item)}>
                <Text style={[styles.itemText, item === ALL && styles.allText]}>{item === ALL ? t('all') : item}</Text>
                <Text style={styles.arrow}>›</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </SwipeBack>
    );
  }

  return (
    <SwipeBack enabled onBack={backFromPaints}>
    <View style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={backFromPaints}>
        <Text style={styles.backText}>‹ {selectedSeries === ALL ? (selectedBrand === ALL ? t('all') : brandLabel(selectedBrand)) : selectedSeries}</Text>
      </TouchableOpacity>
      <ClearableInput
        style={styles.filterInput}
        placeholder={t('colorName')}
        value={nameFilter}
        onChangeText={setNameFilter}
      />
      <FlatList
        data={shownPaints}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(p) => String(p.id)}
        renderItem={({ item }) => (
          <View style={[styles.item, { borderLeftColor: item.hex, borderLeftWidth: 8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name_ja}{item.code ? <Text style={styles.code}>  {item.code}</Text> : null}</Text>
              <View style={styles.subRow}>
                <TypeIcon paintType={item.paint_type} />
                <Text style={styles.sub}>{brandLabel(item.brand)}{item.gloss ? ` · ${glossLabel(item.gloss)}` : ''}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.addBtn} onPress={() => onSelect(item)}>
              <IconPlus color="#fff" size={22} />
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
    </SwipeBack>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  item: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
  allItem: { backgroundColor: '#eef4fb' },
  itemText: { flex: 1, fontSize: 15 },
  allText: { color: '#4a90d9', fontWeight: 'bold' },
  name: { fontSize: 16 },
  code: { fontSize: 12, color: '#999', fontWeight: 'normal' },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  sub: { fontSize: 12, color: '#666' },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#4a90d9', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  arrow: { fontSize: 18, color: '#999' },
  filterInput: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, margin: 12 },
  back: { padding: 12, backgroundColor: '#f5f5f5' },
  backText: { fontSize: 15, color: '#4a90d9' },
});
