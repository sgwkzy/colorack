// app/(tabs)/settings.tsx
import { useState } from 'react';
import { View, Text, Switch, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { getDB, setSetting } from '../../lib/db';
import { t, setLocale, getLocale } from '../../lib/i18n';

export default function SettingsScreen() {
  const [isJa, setIsJa] = useState(getLocale() === 'ja');

  const toggleLang = (val: boolean) => {
    setIsJa(val);
    setLocale(val ? 'ja' : 'en');
  };

  const confirmReset = (title: string, onConfirm: () => Promise<void>) => {
    Alert.alert(title, t('resetConfirmMessage'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('reset'), style: 'destructive', onPress: onConfirm },
    ]);
  };

  const resetOwned = () => confirmReset(t('resetOwned'), async () => {
    const db = getDB();
    await db.runAsync('DELETE FROM inventory');
    await db.runAsync('DELETE FROM boxes');
    const res = await db.runAsync('INSERT INTO boxes (name) VALUES (?)', ['Box']);
    await setSetting('default_box_id', String(res.lastInsertRowId));
  });

  const resetFavorites = () => confirmReset(t('resetFavorites'), async () => {
    await getDB().runAsync("DELETE FROM lists WHERE type = 'favorites'");
  });

  const resetWishlist = () => confirmReset(t('resetWishlist'), async () => {
    await getDB().runAsync("DELETE FROM lists WHERE type = 'wishlist'");
  });

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
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('reset')}</Text>
        <TouchableOpacity style={styles.resetBtn} onPress={resetOwned}>
          <Text style={styles.resetBtnText}>{t('resetOwned')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resetBtn} onPress={resetFavorites}>
          <Text style={styles.resetBtnText}>{t('resetFavorites')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resetBtn} onPress={resetWishlist}>
          <Text style={styles.resetBtnText}>{t('resetWishlist')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  langRow: { flexDirection: 'row', alignItems: 'center' },
  resetBtn: { backgroundColor: '#fdecea', borderRadius: 6, padding: 12, marginBottom: 8 },
  resetBtnText: { color: '#e74c3c', fontWeight: 'bold', textAlign: 'center' },
});
