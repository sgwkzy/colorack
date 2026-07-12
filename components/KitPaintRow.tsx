// components/KitPaintRow.tsx
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconTrash } from '@tabler/icons-react-native';
import { KitPaintRow as KitPaintRowData } from '../lib/db';
import { brandLabel } from '../lib/brands';
import { t } from '../lib/i18n';
import { paintName } from '../lib/paintLabel';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';

interface Props {
  row: KitPaintRowData;
  onNoteChange: (note: string) => void;
  onRemove: () => void;
}

export default function KitPaintRow({ row, onNoteChange, onRemove }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [note, setNote] = useState(row.note ?? '');

  return (
    <View style={styles.row}>
      <View style={styles.top}>
        <View style={[styles.swatch, { backgroundColor: row.hex ?? colors.transparent }]} />
        <View style={styles.info}>
          <Text numberOfLines={1} style={styles.name}>{paintName(row.name_ja, row.name_en)}</Text>
          <Text numberOfLines={1} style={styles.sub}>{brandLabel(row.brand)}{row.code ? ` · ${row.code}` : ''}</Text>
        </View>
        <TouchableOpacity onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('delete')}>
          <IconTrash color={colors.danger} size={20} />
        </TouchableOpacity>
      </View>
      <ClearableInput
        style={styles.noteInput}
        value={note}
        onChangeText={setNote}
        onBlur={() => onNoteChange(note)}
        placeholder={t('note')}
      />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  row: { borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  swatch: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  noteInput: { minHeight: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, color: colors.text, fontSize: 13 },
});
