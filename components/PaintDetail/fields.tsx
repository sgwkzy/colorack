import { Text, View } from 'react-native';
import ClearableInput from '../ClearableInput';
import type { PaintDetailStyles } from './styles';

export function CompactInfo({ label, value, styles }: { label: string; value: string; styles: PaintDetailStyles }) {
  return (
    <View style={styles.compactItem}>
      <Text style={styles.compactLabel}>{label}</Text>
      <Text style={styles.compactValue}>{value || '—'}</Text>
    </View>
  );
}

export function EditField({ label, value, onChangeText, styles }: { label: string; value: string; onChangeText: (value: string) => void; styles: PaintDetailStyles }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <ClearableInput style={styles.input} value={value} onChangeText={onChangeText} autoCapitalize="none" />
    </View>
  );
}

export function ReadonlyField({ label, value, styles }: { label: string; value: string; styles: PaintDetailStyles }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.readonly}>{value || '—'}</Text>
    </View>
  );
}
