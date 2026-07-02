import { Dispatch, SetStateAction, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconCamera } from '@tabler/icons-react-native';
import { glossLabel } from '../lib/gloss';
import { t } from '../lib/i18n';
import { paintTypeLabel } from '../lib/paintType';
import { useTheme, lightColors, radius, spacing, touch } from '../lib/theme';
import ClearableInput from './ClearableInput';

export const TYPE_OPTIONS = ['ラッカー塗料', '水性アクリル塗料', 'エナメル塗料', 'エマルジョン塗料'];
export const GLOSS_OPTIONS = ['光沢', '半光沢', 'つや消し', 'メタリック', 'パール'];

export function isValidHex(value: string) {
  return /^#?[0-9a-fA-F]{6}$/.test(value);
}

interface TextField {
  label: string;
  value: string;
  set: Dispatch<SetStateAction<string>>;
}

interface Props {
  fields: TextField[];
  hex: string;
  setHex: Dispatch<SetStateAction<string>>;
  paintType: string | null;
  setPaintType: Dispatch<SetStateAction<string | null>>;
  gloss: string | null;
  setGloss: Dispatch<SetStateAction<string | null>>;
  onOpenCamera: () => void;
  swatch?: boolean;
}

type ChipStyles = { chip: object; chipOn: object; chipText: object; chipTextOn: object };

export function optionChip(value: string, selected: boolean, label: string, onPress: () => void, chipStyles: ChipStyles) {
  return (
    <TouchableOpacity key={value} style={[chipStyles.chip, selected && chipStyles.chipOn]} onPress={onPress}>
      <Text style={[chipStyles.chipText, selected && chipStyles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function PaintFormFields({
  fields, hex, setHex, paintType, setPaintType, gloss, setGloss, onOpenCamera, swatch = false,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <>
      {fields.map(({ label, value, set }) => (
        <View key={label} style={styles.field}>
          <Text style={styles.label}>{label}</Text>
          <ClearableInput style={styles.input} value={value} onChangeText={set} autoCapitalize="none" />
        </View>
      ))}
      <View style={styles.field}>
        <Text style={styles.label}>{t('hex') + ' (#RRGGBB)'}</Text>
        <View style={styles.hexRow}>
          <ClearableInput style={[styles.input, styles.hexInput]} value={hex} onChangeText={setHex} autoCapitalize="none" />
          {swatch && isValidHex(hex) && (
            <View style={[styles.previewSwatch, { backgroundColor: `#${hex.replace('#', '')}` }]} />
          )}
          <TouchableOpacity
            style={styles.cameraBtn}
            onPress={onOpenCamera}
            accessibilityLabel="カメラで色を取得"
          >
            <IconCamera color={colors.primary} size={22} />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.label}>{t('paintType')}</Text>
      <View style={styles.chipRow}>
        {TYPE_OPTIONS.map((v) => optionChip(v, paintType === v, paintTypeLabel(v),
          () => setPaintType(paintType === v ? null : v), styles))}
      </View>

      <Text style={[styles.label, styles.sectionGap]}>{t('gloss')}</Text>
      <View style={styles.chipRow}>
        {GLOSS_OPTIONS.map((v) => optionChip(v, gloss === v, glossLabel(v),
          () => setGloss(gloss === v ? null : v), styles))}
      </View>
    </>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  field: { marginBottom: spacing.lg },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  hexRow: { flexDirection: 'row', alignItems: 'center' },
  hexInput: { flex: 1 },
  previewSwatch: { marginLeft: spacing.md, width: touch.min, height: touch.min, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  cameraBtn: { marginLeft: spacing.md, width: touch.min, height: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.chip, marginRight: spacing.md, marginBottom: spacing.md },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textSecondary },
  chipTextOn: { color: colors.onPrimary, fontWeight: 'bold' },
  sectionGap: { marginTop: spacing.lg },
});
