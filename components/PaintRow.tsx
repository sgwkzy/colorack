import { ReactNode, useMemo } from 'react';
import { StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';
import { brandLabel } from '../lib/brands';
import { glossLabel } from '../lib/gloss';
import { t } from '../lib/i18n';
import { paintName } from '../lib/paintLabel';
import { useTheme, lightColors, radius, spacing } from '../lib/theme';
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
  ownedCount?: number;
}

export default function PaintRow({ paint, children, style, borderColor, subSuffix, compact = false, ownedCount = 0 }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const sub = `${brandLabel(paint.brand)}${paint.gloss ? ` · ${glossLabel(paint.gloss)}` : ''}${subSuffix ?? ''}`;
  const ownedLabel = `${t('ownedBadge')}${ownedCount >= 2 ? ` ×${ownedCount}` : ''}`;
  // 色ストリップは独立Viewで描き、右端に細い縁取りを付ける。
  // borderLeft方式だと白系/黒系の塗色が行背景・画面背景に溶けて見えなくなるため。
  const stripColor = borderColor ?? paint.hex ?? null;
  return (
    <View style={[styles.row, compact && styles.compact, style]}>
      {stripColor ? <View style={[styles.strip, { backgroundColor: stripColor }]} /> : null}
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
      {ownedCount > 0 ? (
        <View style={styles.ownedBadge}>
          <Text style={styles.ownedBadgeText}>{ownedLabel}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    paddingLeft: spacing.lg + 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  strip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 8,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
  },
  compact: { padding: 10, paddingLeft: 10 + 8 },
  body: { flex: 1 },
  name: { fontSize: 16, color: colors.text },
  compactName: { fontSize: 14 },
  code: { fontSize: 12, color: colors.textPlaceholder, fontWeight: 'normal' },
  compactCode: { fontSize: 11 },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  sub: { fontSize: 12, color: colors.textMuted },
  compactSub: { fontSize: 11 },
  ownedBadge: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3, marginLeft: spacing.sm },
  ownedBadgeText: { color: colors.primary, fontSize: 11, fontWeight: 'bold' },
});
