// components/AddPaint/BarcodeScanner.tsx
import { useState, useMemo } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { getDB } from '../../lib/db';
import { t } from '../../lib/i18n';
import { useTheme, lightColors, radius, spacing } from '../../lib/theme';

interface Paint {
  id: number;
  name_ja: string;
  name_en: string | null;
  brand: string;
  hex: string | null;
}

interface Props {
  onSelect: (paint: Paint) => void;
}

export default function BarcodeScanner({ onSelect }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) return <View />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>{t('scanBarcode')}</Text>
        <TouchableOpacity onPress={requestPermission} accessibilityRole="button" accessibilityLabel={t('allowCamera')}><Text style={styles.link}>{t('allowCamera')}</Text></TouchableOpacity>
      </View>
    );
  }

  const handleBarcode = async ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    const db = getDB();
    const paint = await db.getFirstAsync<Paint>(
      'SELECT id, name_ja, name_en, brand, hex FROM catalog_paints WHERE barcode = ?',
      [data]
    );
    if (paint) {
      onSelect(paint);
    } else {
      Alert.alert('Not found', `Barcode: ${data}`, [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarcode}
      />
      <View style={styles.overlay}>
        <Text style={styles.hint}>{t('scanBarcode')}</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  msg: { fontSize: 15, marginBottom: spacing.xl, textAlign: 'center', color: colors.text },
  link: { color: colors.primary, fontSize: 15 },
  overlay: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' },
  hint: { color: colors.onPrimary, fontSize: 14, backgroundColor: 'rgba(0,0,0,0.5)', padding: spacing.md, borderRadius: radius.sm },
});
