import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconBox, IconPlus } from '@tabler/icons-react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { getDB, KitStatus } from '../../lib/db';
import { setActiveKitBox } from '../../lib/activeKitBox';
import { t, useLocale } from '../../lib/i18n';
import { lightColors, radius, spacing, useTheme } from '../../lib/theme';
import AddKitModal from '../../components/AddKitModal';
import EmptyState from '../../components/EmptyState';
import KitDetailModal from '../../components/KitDetailModal';

interface KitListItem {
  id: number;
  name: string;
  maker: string;
  scale: string | null;
  photo_uri: string | null;
  status: KitStatus;
}

type Selected = 'all' | number;

const STATUS_CHIPS: { key: KitStatus; labelKey: string }[] = [
  { key: 'not_started', labelKey: 'statusNotStarted' },
  { key: 'building', labelKey: 'statusBuilding' },
  { key: 'completed', labelKey: 'statusCompleted' },
];

export default function KitsScreen() {
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const navigation = useNavigation();
  const { boxId } = useLocalSearchParams<{ boxId?: string }>();
  const [selected, setSelected] = useState<Selected>('all');
  const [statuses, setStatuses] = useState<KitStatus[]>(['not_started', 'building', 'completed']);
  const [items, setItems] = useState<KitListItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [detailKitId, setDetailKitId] = useState<number | null>(null);

  useEffect(() => {
    const requested = boxId === 'all' ? 'all' : Number(boxId);
    if (requested === 'all' || (Number.isInteger(requested) && requested > 0)) setSelected(requested);
  }, [boxId]);

  useEffect(() => { setActiveKitBox(selected); }, [selected]);

  useEffect(() => {
    if (selected === 'all') {
      const title = locale === 'ja' ? 'すべてのキットボックス' : 'All Kit Boxes';
      navigation.setOptions({ title });
      return;
    }
    getDB().getFirstAsync<{ name: string }>('SELECT name FROM kit_boxes WHERE id = ?', [selected]).then((box) => {
      if (box) navigation.setOptions({ title: box.name });
    });
  }, [locale, navigation, selected]);

  const load = useCallback(async (sel: Selected, sf: KitStatus[]) => {
    if (sf.length === 0) { setItems([]); return; }
    const where: string[] = [`status IN (${sf.map(() => '?').join(',')})`];
    const args: (string | number)[] = [...sf];
    if (sel !== 'all') { where.push('box_id = ?'); args.push(sel); }
    const rows = await getDB().getAllAsync<KitListItem>(
      'SELECT id, name, maker, scale, photo_uri, status FROM kits WHERE ' + where.join(' AND ') + ' ORDER BY added_at DESC',
      args
    );
    setItems(rows);
  }, []);

  useFocusEffect(useCallback(() => { load(selected, statuses); }, [load, selected, statuses]));

  const reload = () => load(selected, statuses);
  const toggleStatus = (s: KitStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setStatuses(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.chipRow}>
        {STATUS_CHIPS.map((chip) => {
          const active = statuses.includes(chip.key);
          return (
            <TouchableOpacity key={chip.key} style={[styles.chip, active && styles.chipActive]} onPress={() => toggleStatus(chip.key)}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{t(chip.labelKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => setDetailKitId(item.id)}>
            {item.photo_uri ? (
              <Image source={{ uri: item.photo_uri }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={styles.thumbPlaceholder}><IconBox color={colors.textFaint} size={22} /></View>
            )}
            <View style={styles.rowInfo}>
              <Text numberOfLines={1} style={styles.rowName}>{item.name}</Text>
              <Text numberOfLines={1} style={styles.rowSub}>{item.maker}{item.scale ? ` · ${item.scale}` : ''}</Text>
            </View>
            <Text style={styles.rowStatus}>{t(STATUS_CHIPS.find((c) => c.key === item.status)?.labelKey ?? 'status')}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={(
          <EmptyState icon={IconBox} title={t('emptyKits')} actionLabel={t('addKit')} onAction={() => setShowAdd(true)} />
        )}
      />

      <TouchableOpacity style={styles.fab} onPress={() => setShowAdd(true)} accessibilityRole="button" accessibilityLabel={t('addKit')}>
        <IconPlus color={colors.onPrimary} size={26} />
      </TouchableOpacity>

      <AddKitModal
        visible={showAdd}
        defaultBoxId={selected === 'all' ? null : selected}
        onClose={() => { setShowAdd(false); reload(); }}
      />
      <KitDetailModal
        visible={detailKitId != null}
        kitId={detailKitId}
        onClose={() => setDetailKitId(null)}
        onChanged={reload}
      />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  chipRow: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.chip },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text },
  chipTextActive: { color: colors.onPrimary, fontWeight: '700' },
  list: { paddingBottom: 96 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  thumb: { width: 48, height: 48, borderRadius: radius.sm },
  thumbPlaceholder: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowStatus: { fontSize: 12, color: colors.textFaint },
  fab: { position: 'absolute', right: spacing.xl, bottom: spacing.xl, width: 56, height: 56, borderRadius: radius.fab, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
