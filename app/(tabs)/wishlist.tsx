// app/(tabs)/wishlist.tsx
import { useCallback, useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { IconPlus } from '@tabler/icons-react-native';
import { useFocusEffect } from 'expo-router';
import { getDB } from '../../lib/db';
import { t } from '../../lib/i18n';
import { useTheme, lightColors, radius, spacing } from '../../lib/theme';
import AddPaintModal from '../../components/AddPaint';
import PaintRow from '../../components/PaintRow';

interface ListItem {
  id: number;
  paint_id: number;
  name_ja: string;
  name_en: string | null;
  code: string;
  brand: string;
  hex: string;
  gloss: string | null;
  paint_type: string | null;
}

export default function WishlistScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<ListItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    const db = getDB();
    const rows = await db.getAllAsync<ListItem>(
      'SELECT l.id, l.paint_id, c.name_ja, c.name_en, c.code, c.brand, c.hex, c.gloss, c.paint_type'
      + ' FROM lists l JOIN catalog_paints c ON l.paint_id = c.id'
      + " WHERE l.type = 'wishlist' ORDER BY l.added_at DESC"
    );
    setItems(rows);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const deleteItem = async (item: ListItem) => {
    await getDB().runAsync('DELETE FROM lists WHERE id = ?', [item.id]);
    load();
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <Swipeable
            overshootRight={false}
            renderRightActions={() => (
              <TouchableOpacity style={styles.deleteAction} onPress={() => deleteItem(item)}>
                <Text style={styles.deleteActionText}>{t('delete')}</Text>
              </TouchableOpacity>
            )}
          >
            <PaintRow paint={item} />
          </Swipeable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t('noResults')}</Text>}
      />
      <TouchableOpacity style={styles.fab} onPress={() => setShowAdd(true)}>
        <IconPlus color={colors.onPrimary} size={28} />
      </TouchableOpacity>
      <AddPaintModal
        visible={showAdd}
        onClose={() => { setShowAdd(false); load(); }}
        defaultStatus="wishlist"
      />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
  deleteAction: { backgroundColor: colors.danger, justifyContent: 'center', alignItems: 'center', width: 88 },
  deleteActionText: { color: colors.onPrimary, fontWeight: 'bold' },
  fab: {
    position: 'absolute', bottom: spacing.xxl, right: spacing.xxl,
    width: 56, height: 56, borderRadius: radius.fab,
    backgroundColor: '#6a5acd', alignItems: 'center', justifyContent: 'center',
  },
});
