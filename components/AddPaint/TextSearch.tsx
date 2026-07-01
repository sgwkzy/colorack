// components/AddPaint/TextSearch.tsx
import { useState } from 'react';
import { View, FlatList, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { IconPlus } from '@tabler/icons-react-native';
import ClearableInput from '../ClearableInput';
import { getDB } from '../../lib/db';
import { t } from '../../lib/i18n';
import { brandLabel } from '../../lib/brands';
import { glossLabel } from '../../lib/gloss';
import TypeIcon from '../TypeIcon';

interface Paint {
  id: number;
  name_ja: string;
  name_en: string;
  code: string;
  brand: string;
  hex: string;
  gloss: string | null;
  paint_type: string | null;
}

interface Props {
  onSelect: (paint: Paint) => void;
}

export default function TextSearch({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Paint[]>([]);

  const search = async (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    const db = getDB();
    const rows = await db.getAllAsync<Paint>(
      'SELECT id, name_ja, name_en, code, brand, hex, gloss, paint_type FROM catalog_paints'
      + ' WHERE name_ja LIKE ? OR name_en LIKE ? OR brand LIKE ? OR series LIKE ?'
      + ' LIMIT 50',
      [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]
    );
    setResults(rows);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.fieldsLabel}>{t('searchFields')}</Text>
      <ClearableInput
        style={styles.input}
        placeholder={t('searchPlaceholder')}
        value={query}
        onChangeText={search}
      />
      <FlatList
        data={results}
        keyExtractor={(item) => String(item.id)}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={[styles.row, { borderLeftColor: item.hex, borderLeftWidth: 8 }]}>
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
        ListEmptyComponent={query ? <Text style={styles.empty}>{t('noResults')}</Text> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fieldsLabel: { fontSize: 12, color: '#888', marginHorizontal: 12, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginHorizontal: 12, marginTop: 6, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#4a90d9', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  name: { fontSize: 15 },
  code: { fontSize: 11, color: '#999' },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  sub: { fontSize: 12, color: '#666' },
  empty: { textAlign: 'center', marginTop: 24, color: '#999' },
});
