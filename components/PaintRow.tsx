import { ReactNode, useMemo } from 'react';
import { StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';
import { brandLabel } from '../lib/brands';
import { glossLabel } from '../lib/gloss';
import { paintName } from '../lib/paintLabel';
import { useTheme, lightColors, spacing } from '../lib/theme';
import TypeIcon from './TypeIcon';

interface PaintLike {
  name_ja: string;
  name_en: string | null;
  code?: string | null;
  brand: string;
  hex?: string | null;
  gloss: string | null;
  paint_type: string | null;
}

interface Props {
  paint: PaintLike;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  borderColor?: string | null;
  subSuffix?: string;
  compact?: boolean;
}

export default function PaintRow({ paint, children, style, borderColor, subSuffix, compact = false }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const sub = `${brandLabel(paint.brand)}${paint.gloss ? ` · ${glossLabel(paint.gloss)}` : ''}${subSuffix ?? ''}`;
  return (
    <View style={[styles.row, compact && styles.compact, { borderLeftColor: borderColor ?? paint.hex ?? colors.transparent }, style]}>
      <View style={styles.body}>
        <Text style={[styles.name, compact && styles.compactName]}>
          {paintName(paint.name_ja, paint.name_en)}
          {paint.code ? <Text style={[styles.code, compact && styles.compactCode]}>  {paint.code}</Text> : null}
        </Text>
        <View style={styles.subRow}>
          <TypeIcon paintType={paint.paint_type} />
          <Text style={[styles.sub, compact && styles.compactSub]}>{sub}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    borderLeftWidth: 8,
  },
  compact: { padding: 10 },
  body: { flex: 1 },
  name: { fontSize: 16 },
  compactName: { fontSize: 14 },
  code: { fontSize: 12, color: colors.textPlaceholder, fontWeight: 'normal' },
  compactCode: { fontSize: 11 },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  sub: { fontSize: 12, color: colors.textMuted },
  compactSub: { fontSize: 11 },
});
