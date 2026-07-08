// app/(tabs)/catalog.tsx
// 全塗料をブランド→シリーズ→塗料と階層で閲覧。手動追加(source='manual')だけ
// 編集/削除でき、公式カタログは読み取り専用。右下FABで新規追加。
import { useCallback, useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { IconChevronLeft, IconChevronRight, IconPlus, IconTrash } from '@tabler/icons-react-native';
import { useFocusEffect } from 'expo-router';
import { getDB, getOwnedCountMap } from '../../lib/db';
import { t, useLocale } from '../../lib/i18n';
import { brandLabel } from '../../lib/brands';
import { paintName, seriesLabel } from '../../lib/paintLabel';
import { useTheme, lightColors, radius, spacing } from '../../lib/theme';
import AdBanner from '../../components/AdBanner';
import ClearableInput from '../../components/ClearableInput';
import PaintDetailModal from '../../components/PaintDetailModal';
import PaintFormModal, { EditablePaint } from '../../components/PaintFormModal';
import SwipeBack from '../../components/SwipeBack';
import PaintRow from '../../components/PaintRow';

interface Paint extends EditablePaint { name_en: string | null; source: string | null; series_en: string | null; }

// 階層を横断して「すべて」を表す番兵。
const ALL = 'ALL';

export default function CatalogScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  useLocale();
  const [brands, setBrands] = useState<string[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [seriesList, setSeriesList] = useState<{ series: string; series_en: string | null }[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const [paints, setPaints] = useState<Paint[]>([]);
  const [ownedCounts, setOwnedCounts] = useState<Map<number, number>>(new Map());
  const [nameFilter, setNameFilter] = useState('');
  const [editing, setEditing] = useState<EditablePaint | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [detailPaintId, setDetailPaintId] = useState<number | null>(null);

  const loadBrands = useCallback(async () => {
    const db = getDB();
    const rows = await db.getAllAsync<{ brand: string }>('SELECT DISTINCT brand FROM catalog_paints ORDER BY brand');
    setBrands(rows.map((r) => r.brand));
  }, []);

  const loadSeries = useCallback(async (brand: string) => {
    const db = getDB();
    setSeriesList(await db.getAllAsync<{ series: string; series_en: string | null }>(
      'SELECT series, MAX(series_en) AS series_en FROM catalog_paints WHERE brand = ? GROUP BY series ORDER BY series',
      [brand]
    ));
  }, []);

  const loadPaints = useCallback(async (brand: string, series: string) => {
    const db = getDB();
    const where: string[] = [];
    const args: string[] = [];
    if (brand !== ALL) { where.push('brand = ?'); args.push(brand); }
    if (series !== ALL) { where.push('series = ?'); args.push(series); }
    const sql = 'SELECT id, name_ja, name_en, brand, series, series_en, code, hex, gloss, paint_type, source FROM catalog_paints'
      + (where.length ? ' WHERE ' + where.join(' AND ') : '')
      + ' ORDER BY code COLLATE NOCASE';
    const [rows, ownedMap] = await Promise.all([
      db.getAllAsync<Paint>(sql, args),
      getOwnedCountMap(),
    ]);
    setPaints(rows);
    setOwnedCounts(ownedMap);
  }, []);

  // フォーカス時は現在の階層を再取得(追加/編集の反映)。
  const reload = useCallback(() => {
    if (selectedBrand && selectedSeries) loadPaints(selectedBrand, selectedSeries);
    else if (selectedBrand) loadSeries(selectedBrand);
    else loadBrands();
  }, [selectedBrand, selectedSeries, loadBrands, loadSeries, loadPaints]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const openBrand = (b: string) => {
    setSelectedBrand(b); setPaints([]);
    if (b === ALL) { setSelectedSeries(ALL); setNameFilter(''); loadPaints(ALL, ALL); return; }
    setSelectedSeries(null); loadSeries(b);
  };
  const openSeries = (s: string) => { setSelectedSeries(s); setNameFilter(''); loadPaints(selectedBrand!, s); };
  const backFromPaints = () => {
    if (selectedBrand === ALL) { setSelectedBrand(null); setSelectedSeries(null); }
    else setSelectedSeries(null);
  };
  const openNew = () => { setEditing(null); setShowForm(true); };

  const remove = (p: Paint) => {
    Alert.alert(paintName(p.name_ja, p.name_en), t('deletePaintConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          const db = getDB();
          await db.runAsync('DELETE FROM inventory WHERE paint_id = ?', [p.id]);
          await db.runAsync('DELETE FROM lists WHERE paint_id = ?', [p.id]);
          await db.runAsync('DELETE FROM catalog_paints WHERE id = ?', [p.id]);
          loadPaints(selectedBrand!, selectedSeries!);
        },
      },
    ]);
  };

  const fab = (
    <>
      <TouchableOpacity style={styles.fab} onPress={openNew}>
        <IconPlus color={colors.onPrimary} size={28} />
      </TouchableOpacity>
      <PaintFormModal visible={showForm} paint={editing} onClose={() => setShowForm(false)} onSaved={reload} />
      <PaintDetailModal
        visible={detailPaintId != null}
        paintId={detailPaintId}
        onClose={() => setDetailPaintId(null)}
        onChanged={reload}
      />
    </>
  );

  // --- ブランド一覧 ---
  if (!selectedBrand) {
    return (
      <View style={styles.container}>
        <View style={styles.adBar}><AdBanner /></View>
        <FlatList
          data={[ALL, ...brands]}
          keyExtractor={(b) => b || '(none)'}
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.navItem, item === ALL && styles.allItem]} onPress={() => openBrand(item)}>
              <Text style={[styles.navText, item === ALL && styles.allText]}>{item === ALL ? t('all') : brandLabel(item)}</Text>
              <IconChevronRight color={colors.textPlaceholder} size={18} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>{t('noResults')}</Text>}
        />
        {fab}
      </View>
    );
  }

  // --- シリーズ一覧 ---
  if (!selectedSeries) {
    return (
      <SwipeBack enabled onBack={() => setSelectedBrand(null)}>
        <View style={styles.container}>
          <TouchableOpacity style={styles.back} onPress={() => setSelectedBrand(null)}>
            <IconChevronLeft color={colors.primary} size={18} />
            <Text style={styles.backText}>{brandLabel(selectedBrand)}</Text>
          </TouchableOpacity>
          <View style={styles.adBar}><AdBanner /></View>
          <FlatList
            data={[{ series: ALL, series_en: null }, ...seriesList]}
            keyExtractor={(s) => s.series || '(none)'}
            renderItem={({ item }) => (
              <TouchableOpacity style={[styles.navItem, item.series === ALL && styles.allItem]} onPress={() => openSeries(item.series)}>
                <Text style={[styles.navText, item.series === ALL && styles.allText]}>{item.series === ALL ? t('all') : seriesLabel(item.series || '—', item.series_en)}</Text>
                <IconChevronRight color={colors.textPlaceholder} size={18} />
              </TouchableOpacity>
            )}
          />
          {fab}
        </View>
      </SwipeBack>
    );
  }

  // --- 塗料一覧 ---
  const q = nameFilter.trim().toLowerCase();
  const shown = q ? paints.filter((p) => p.name_ja.toLowerCase().includes(q) || (p.name_en ?? '').toLowerCase().includes(q) || (p.code ?? '').toLowerCase().includes(q)) : paints;
  const currentSeries = paints.find((p) => p.series === selectedSeries);
  return (
    <SwipeBack enabled onBack={backFromPaints}>
    <View style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={backFromPaints}>
        <IconChevronLeft color={colors.primary} size={18} />
        <Text style={styles.backText}>{selectedSeries === ALL ? (selectedBrand === ALL ? t('all') : brandLabel(selectedBrand)) : seriesLabel(selectedSeries || '—', currentSeries?.series_en)}</Text>
      </TouchableOpacity>
      <ClearableInput style={styles.filterInput} placeholder={t('colorName')} value={nameFilter} onChangeText={setNameFilter} />
      <View style={styles.adBar}><AdBanner /></View>
      <FlatList
        data={shown}
        keyExtractor={(p) => String(p.id)}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const manual = item.source === 'manual';
          return (
            <TouchableOpacity
              onPress={() => setDetailPaintId(item.id)}
            >
              <PaintRow paint={item} borderColor={item.hex ?? colors.transparent} ownedCount={ownedCounts.get(item.id) ?? 0}>
              {manual ? (
                <TouchableOpacity style={styles.delBtn} onPress={() => remove(item)} hitSlop={8}>
                  <IconTrash color={colors.danger} size={22} />
                </TouchableOpacity>
              ) : null}
              </PaintRow>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>{t('noResults')}</Text>}
      />
      {fab}
    </View>
    </SwipeBack>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  adBar: { borderTopWidth: 1, borderTopColor: colors.borderLight, marginVertical: spacing.sm },
  navItem: { flexDirection: 'row', alignItems: 'center', padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  allItem: { backgroundColor: colors.primarySoft },
  navText: { flex: 1, fontSize: 16, color: colors.text },
  allText: { color: colors.primary, fontWeight: 'bold' },
  back: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceAlt },
  backText: { fontSize: 15, color: colors.primary },
  filterInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: spacing.md, margin: spacing.lg },
  delBtn: { padding: spacing.md, marginLeft: spacing.md },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
  fab: { position: 'absolute', right: spacing.xxl, bottom: spacing.xxl, width: 56, height: 56, borderRadius: radius.fab, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
