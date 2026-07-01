// app/(tabs)/settings.tsx
import { useCallback, useState } from 'react';
import { View, Text, Switch, FlatList, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { IconPlus, IconStar, IconStarFilled } from '@tabler/icons-react-native';
import { useFocusEffect } from 'expo-router';
import { getDB, getDefaultBoxId, setSetting } from '../../lib/db';
import { t, setLocale, getLocale } from '../../lib/i18n';

interface Box {
  id: number;
  name: string;
  location: string;
  note: string;
}

export default function SettingsScreen() {
  const [isJa, setIsJa] = useState(getLocale() === 'ja');
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [defaultBoxId, setDefaultBoxId] = useState<number | null>(null);
  const [newBoxName, setNewBoxName] = useState('');
  const [newBoxLocation, setNewBoxLocation] = useState('');

  const loadBoxes = useCallback(async () => {
    const db = getDB();
    setBoxes(await db.getAllAsync<Box>('SELECT * FROM boxes ORDER BY id'));
    setDefaultBoxId(await getDefaultBoxId());
  }, []);

  useFocusEffect(useCallback(() => { loadBoxes(); }, [loadBoxes]));

  const toggleLang = (val: boolean) => {
    setIsJa(val);
    setLocale(val ? 'ja' : 'en');
  };

  const addBox = async () => {
    if (!newBoxName.trim()) return;
    const db = getDB();
    await db.runAsync(
      'INSERT INTO boxes (name, location) VALUES (?, ?)',
      [newBoxName.trim(), newBoxLocation.trim()]
    );
    setNewBoxName('');
    setNewBoxLocation('');
    loadBoxes();
  };

  const deleteBox = async (id: number) => {
    Alert.alert(t('delete'), '', [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          const db = getDB();
          await db.runAsync('UPDATE inventory SET box_id = NULL WHERE box_id = ?', [id]);
          await db.runAsync('DELETE FROM boxes WHERE id = ?', [id]);
          loadBoxes();
        },
      },
    ]);
  };

  const makeDefault = async (id: number) => {
    // 同じものを再タップで解除
    const next = defaultBoxId === id ? '' : String(id);
    await setSetting('default_box_id', next);
    setDefaultBoxId(next ? id : null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('language')}</Text>
        <View style={styles.langRow}>
          <Text>EN</Text>
          <Switch value={isJa} onValueChange={toggleLang} style={{ marginHorizontal: 8 }} />
          <Text>JA</Text>
        </View>
      </View>
      <View style={[styles.section, { flex: 1 }]}>
        <Text style={styles.sectionTitle}>{t('box')}</Text>
        <Text style={styles.hint}>{t('defaultBox')}</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { flex: 2 }]}
            placeholder={t('name')}
            value={newBoxName}
            onChangeText={setNewBoxName}
          />
          <TextInput
            style={[styles.input, { flex: 2, marginLeft: 8 }]}
            placeholder={t('location')}
            value={newBoxLocation}
            onChangeText={setNewBoxLocation}
          />
          <TouchableOpacity style={styles.addBtn} onPress={addBox}>
            <IconPlus color="#fff" size={20} />
          </TouchableOpacity>
        </View>
        <FlatList
          data={boxes}
          keyExtractor={(b) => String(b.id)}
          renderItem={({ item }) => (
            <View style={styles.boxRow}>
              <TouchableOpacity
                style={[styles.defaultChip, defaultBoxId === item.id && styles.defaultChipOn]}
                onPress={() => makeDefault(item.id)}
              >
                {defaultBoxId === item.id
                  ? <IconStarFilled color="#fff" size={13} />
                  : <IconStar color="#888" size={13} />}
                <Text style={[styles.defaultChipText, defaultBoxId === item.id && styles.defaultChipTextOn, { marginLeft: 4 }]}>
                  {t('default')}
                </Text>
              </TouchableOpacity>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.boxName}>{item.name}</Text>
                {item.location ? <Text style={styles.boxLoc}>{item.location}</Text> : null}
              </View>
              <TouchableOpacity onPress={() => deleteBox(item.id)}>
                <Text style={styles.delBtn}>{t('delete')}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  hint: { fontSize: 12, color: '#888', marginBottom: 8 },
  langRow: { flexDirection: 'row', alignItems: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  addBtn: { marginLeft: 8, backgroundColor: '#4a90d9', padding: 10, borderRadius: 6 },
  addBtnText: { color: '#fff', fontSize: 20 },
  boxRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  defaultChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12, backgroundColor: '#f0f0f0' },
  defaultChipOn: { backgroundColor: '#4a90d9' },
  defaultChipText: { fontSize: 11, color: '#888' },
  defaultChipTextOn: { color: '#fff', fontWeight: 'bold' },
  boxName: { fontSize: 15 },
  boxLoc: { fontSize: 12, color: '#666' },
  delBtn: { color: '#e74c3c' },
});
