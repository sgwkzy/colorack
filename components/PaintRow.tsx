import { ReactNode, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle, StyleProp } from 'react-native';
import { brandLabel } from '../lib/brands';
import { glossLabel } from '../lib/gloss';
import { t } from '../lib/i18n';
import { paintName } from '../lib/paintLabel';
import { useTheme, lightColors, radius, spacing } from '../lib/theme';
import { useUiPrefs, type ListFontSize } from '../lib/uiPrefs';
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
  quietOwnedBadge?: boolean;
  onPress?: () => void;
}

const FONT_SIZES: Record<ListFontSize, { name: number; compactName: number; code: number; compactCode: number; sub: number; compactSub: number; badge: number }> = {
  small: { name: 14, compactName: 13, code: 11, compactCode: 10, sub: 11, compactSub: 10, badge: 10 },
  medium: { name: 16, compactName: 14, code: 12, compactCode: 11, sub: 12, compactSub: 11, badge: 11 },
  large: { name: 18, compactName: 16, code: 13, compactCode: 12, sub: 13, compactSub: 12, badge: 12 },
};

export default function PaintRow({ paint, children, style, borderColor, subSuffix, compact = false, ownedCount = 0, quietOwnedBadge = false, onPress }: Props) {
  const { colors } = useTheme();
  const { listFontSize } = useUiPrefs();
  const styles = useMemo(() => makeStyles(colors, listFontSize), [colors, listFontSize]);
  const sub = `${brandLabel(paint.brand)}${paint.gloss ? ` · ${glossLabel(paint.gloss)}` : ''}${subSuffix ?? ''}`;
  const ownedLabel = `${t('ownedBadge')}${ownedCount >= 2 ? ` ×${ownedCount}` : ''}`;
  const swatchColor = borderColor ?? paint.hex ?? null;
  const details = <>
    <Text style={[styles.name, compact && styles.compactName]}>
      {paintName(paint.name_ja, paint.name_en)}
      {paint.code ? <Text style={[styles.code, compact && styles.compactCode]}>  {paint.code}</Text> : null}
    </Text>
    <View style={styles.subRow}>
      <TypeIcon paintType={paint.paint_type} />
      <Text style={[styles.sub, compact && styles.compactSub]} numberOfLines={1}>{sub}</Text>
    </View>
  </>;
  return (
    <View style={[styles.row, compact && styles.compact, style]}>
      <View style={[styles.swatch, swatchColor ? { backgroundColor: swatchColor } : styles.emptySwatch]}>
        {!swatchColor ? <Text style={styles.emptySwatchText}>—</Text> : null}
      </View>
      {onPress ? <TouchableOpacity style={styles.body} onPress={onPress} accessibilityRole="button">{details}</TouchableOpacity> : <View style={styles.body}>{details}</View>}
      {ownedCount > 0 ? (
        <View style={[styles.ownedBadge, quietOwnedBadge && styles.quietOwnedBadge]}>
          <Text style={[styles.ownedBadgeText, quietOwnedBadge && styles.quietOwnedBadgeText]}>{ownedLabel}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

const makeStyles = (colors: typeof lightColors, fontSize: ListFontSize) => {
  const sizes = FONT_SIZES[fontSize];
  return StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  swatch: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, marginRight: spacing.md },
  emptySwatch: { backgroundColor: colors.chipAlt },
  emptySwatchText: { color: colors.textFaint, fontSize: 12, lineHeight: 14 },
  compact: { padding: 10 },
  body: { flex: 1 },
  name: { fontSize: sizes.name, color: colors.text },
  compactName: { fontSize: sizes.compactName },
  code: { fontSize: sizes.code, color: colors.textPlaceholder, fontWeight: 'normal' },
  compactCode: { fontSize: sizes.compactCode },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  sub: { fontSize: sizes.sub, color: colors.textMuted, flexShrink: 1 },
  compactSub: { fontSize: sizes.compactSub, flexShrink: 1 },
  ownedBadge: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3, marginLeft: spacing.sm },
  ownedBadgeText: { color: colors.primaryText, fontSize: sizes.badge, fontWeight: 'bold' },
  quietOwnedBadge: { backgroundColor: colors.transparent, paddingHorizontal: spacing.xs },
  quietOwnedBadgeText: { fontWeight: 'normal' },
});
};
