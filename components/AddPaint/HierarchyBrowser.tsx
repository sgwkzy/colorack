// components/AddPaint/HierarchyBrowser.tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { IconPlus } from '@tabler/icons-react-native';
import ClearableInput from '../ClearableInput';
import { getDB } from '../../lib/db';
import { t } from '../../lib/i18n';
import { brandLabel } from '../../lib/brands';
import { seriesLabel } from '../../lib/paintLabel';
import { colors, radius, spacing, touch } from '../../lib/theme';
import PaintRow from '../PaintRow';
import SwipeBack from '../SwipeBack';

interface Paint {
  id: number;
  name_ja: string;
  name_en: string | null;
  code: string;
  brand: string;
  series: string;
  series_en: string | null;
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
  const [seriesList, setSeriesList] = useState<{ series: string; series_en: string | null }[]>([]);
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
    const sql = 'SELECT id, name_ja, name_en, code, brand, series, series_en, hex, gloss, paint_type FROM catalog_paints'
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
    const rows = await getDB().getAllAsync<{ series: string; series_en: string | null }>(
      'SELECT series, MAX(series_en) AS series_en FROM catalog_paints WHERE brand = ? GROUP BY series ORDER BY series',
      [brand]
    );
    setSeriesList(rows);
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
            data={[{ series: ALL, series_en: null }, ...seriesList]}
            keyExtractor={(s) => s.series}
            renderItem={({ item }) => (
              <TouchableOpacity style={[styles.item, item.series === ALL && styles.allItem]} onPress={() => selectSeries(item.series)}>
                <Text style={[styles.itemText, item.series === ALL && styles.allText]}>{item.series === ALL ? t('all') : seriesLabel(item.series, item.series_en)}</Text>
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
        <Text style={styles.backText}>‹ {selectedSeries === ALL ? (selectedBrand === ALL ? t('all') : brandLabel(selectedBrand)) : seriesLabel(selectedSeries, paints.find((p) => p.series === selectedSeries)?.series_en)}</Text>
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
          <PaintRow paint={item} style={styles.itemPaint}>
            <TouchableOpacity style={styles.addBtn} onPress={() => onSelect(item)}>
              <IconPlus color={colors.onPrimary} size={22} />
            </TouchableOpacity>
          </PaintRow>
        )}
      />
    </View>
    </SwipeBack>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  item: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  itemPaint: { padding: 14 },
  allItem: { backgroundColor: colors.primarySoft },
  itemText: { flex: 1, fontSize: 15 },
  allText: { color: colors.primary, fontWeight: 'bold' },
  addBtn: { width: touch.min, height: touch.min, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
  arrow: { fontSize: 18, color: colors.textPlaceholder },
  filterInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: spacing.md, margin: spacing.lg },
  back: { padding: spacing.lg, backgroundColor: colors.surfaceAlt },
  backText: { fontSize: 15, color: colors.primary },
});
