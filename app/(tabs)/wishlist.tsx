// app/(tabs)/wishlist.tsx
import { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { IconPlus } from '@tabler/icons-react-native';
import { useFocusEffect } from 'expo-router';
import { getDB } from '../../lib/db';
import { t } from '../../lib/i18n';
import { brandLabel } from '../../lib/brands';
import { glossLabel } from '../../lib/gloss';
import AddPaintModal from '../../components/AddPaint';
import TypeIcon from '../../components/TypeIcon';

interface ListItem {
  id: number;
  paint_id: number;
  name_ja: string;
  code: string;
  brand: string;
  hex: string;
  gloss: string | null;
  paint_type: string | null;
}

export default function WishlistScreen() {
  const [items, setItems] = useState<ListItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    const db = getDB();
    const rows = await db.getAllAsync<ListItem>(
      'SELECT l.id, l.paint_id, c.name_ja, c.code, c.brand, c.hex, c.gloss, c.paint_type'
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
            <View style={[styles.row, { borderLeftColor: item.hex, borderLeftWidth: 8 }]}>
              <Text style={styles.name}>
                {item.name_ja}{item.code ? <Text style={styles.code}>  {item.code}</Text> : null}
              </Text>
              <View style={styles.subRow}>
                <TypeIcon paintType={item.paint_type} />
                <Text style={styles.sub}>{brandLabel(item.brand)}{item.gloss ? ` · ${glossLabel(item.gloss)}` : ''}</Text>
              </View>
            </View>
          </Swipeable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t('noResults')}</Text>}
      />
      <TouchableOpacity style={styles.fab} onPress={() => setShowAdd(true)}>
        <IconPlus color="#fff" size={28} />
      </TouchableOpacity>
      <AddPaintModal
        visible={showAdd}
        onClose={() => { setShowAdd(false); load(); }}
        defaultStatus="wishlist"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: { padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  name: { fontSize: 16 },
  code: { fontSize: 12, color: '#999' },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  sub: { fontSize: 12, color: '#666' },
  empty: { textAlign: 'center', marginTop: 40, color: '#999' },
  deleteAction: { backgroundColor: '#e74c3c', justifyContent: 'center', alignItems: 'center', width: 88 },
  deleteActionText: { color: '#fff', fontWeight: 'bold' },
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#6a5acd', alignItems: 'center', justifyContent: 'center',
  },
});
