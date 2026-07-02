// components/AddPaint/TextSearch.tsx
import { useState } from 'react';
import { View, FlatList, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { IconPlus } from '@tabler/icons-react-native';
import ClearableInput from '../ClearableInput';
import { getDB } from '../../lib/db';
import { t } from '../../lib/i18n';
import { colors, radius, spacing } from '../../lib/theme';
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
          <PaintRow paint={item}>
            <TouchableOpacity style={styles.addBtn} onPress={() => onSelect(item)}>
              <IconPlus color={colors.onPrimary} size={22} />
            </TouchableOpacity>
          </PaintRow>
        )}
        ListEmptyComponent={query ? <Text style={styles.empty}>{t('noResults')}</Text> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fieldsLabel: { fontSize: 12, color: colors.textFaint, marginHorizontal: spacing.lg, marginTop: spacing.lg },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, marginHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.lg },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
  empty: { textAlign: 'center', marginTop: spacing.xxl, color: colors.textPlaceholder },
});
