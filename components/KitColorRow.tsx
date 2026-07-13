// components/KitColorRow.tsx
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronLeft, IconChevronRight, IconTrash } from '@tabler/icons-react-native';
import { KitColorSummary } from '../lib/db';
import { mixHexColors } from '../lib/colorMix';
import { t } from '../lib/i18n';
import { paintName } from '../lib/paintLabel';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';

interface Props {
  color: KitColorSummary;
  onNameChange: (name: string) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  // falseの間は名前を読み取り専用にし、削除・並び替えボタンを隠す。
  editable: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
}

export default function KitColorRow({ color, onNameChange, onRemove, onMove, editable, canMoveLeft, canMoveRight }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState(color.name ?? '');

  const swatchHex = useMemo(() => mixHexColors(
    color.paints.filter((p) => p.hex).map((p) => ({ hex: p.hex as string, ratio: p.ratio }))
  ), [color.paints]);

  const fallbackName = color.paints[0] ? paintName(color.paints[0].name_ja, color.paints[0].name_en) : '';
  const breakdown = color.paints
    .map((p) => `${paintName(p.name_ja, p.name_en)} ${Math.round(p.ratio * 100)}%`)
    .join(' + ');

  return (
    <View style={styles.row}>
      <View style={styles.top}>
        <View style={[styles.swatch, { backgroundColor: swatchHex ?? colors.transparent }]} />
        {editable ? (
          <ClearableInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            onBlur={() => onNameChange(name)}
            placeholder={fallbackName || t('colorNameLabel')}
          />
        ) : (
          <Text numberOfLines={1} style={styles.nameText}>{name || fallbackName || t('colorNameLabel')}</Text>
        )}
        {editable ? (
          <TouchableOpacity onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('delete')}>
            <IconTrash color={colors.danger} size={20} />
          </TouchableOpacity>
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.breakdown}>{breakdown}</Text>
      {editable ? (
        <View style={styles.moveRow}>
          <TouchableOpacity
            style={[styles.moveBtn, !canMoveLeft && styles.moveBtnDisabled]}
            onPress={() => onMove(-1)}
            disabled={!canMoveLeft}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('moveLeft')}
          >
            <IconChevronLeft color={canMoveLeft ? colors.text : colors.textFaint} size={18} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.moveBtn, !canMoveRight && styles.moveBtnDisabled]}
            onPress={() => onMove(1)}
            disabled={!canMoveRight}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('moveRight')}
          >
            <IconChevronRight color={canMoveRight ? colors.text : colors.textFaint} size={18} />
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  row: { borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  swatch: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  breakdown: { fontSize: 12, color: colors.textMuted },
  nameInput: { flex: 1, minHeight: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text, fontSize: 15, fontWeight: '600' },
  nameText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  moveRow: { flexDirection: 'row', gap: spacing.sm },
  moveBtn: { width: touch.min, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  moveBtnDisabled: { opacity: 0.4 },
});
