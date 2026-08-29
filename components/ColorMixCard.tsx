import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { mixHexColors } from '../lib/colorMix';
import { ColorMixPaint, ColorMixSummary } from '../lib/colorMixDraft';
import { t, useLocale } from '../lib/i18n';
import { brandLabel } from '../lib/brands';
import { paintName } from '../lib/paintLabel';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';

interface Props {
  color: ColorMixSummary;
  onPress: () => void;
  ownedMap?: Map<number, number>;
}

function paintHex(paint: ColorMixPaint, fallback: string): string {
  return paint.hex ?? fallback;
}

export default function ColorMixCard({ color, onPress }: Props) {
  useLocale();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const resultHex = color.paints.length > 0 && color.paints.every((paint) => paint.hex && /^#?[0-9a-fA-F]{6}$/.test(paint.hex))
    ? mixHexColors(color.paints.map((paint) => ({ hex: paint.hex as string, ratio: paint.ratio })))
    : null;
  const visiblePaints = color.paints.slice(0, 2);
  const hiddenCount = Math.max(0, color.paints.length - visiblePaints.length);
  const name = color.name?.trim() || (color.paints[0] ? paintName(color.paints[0].name_ja, color.paints[0].name_en) : t('mixResult'));
  const resultLabel = resultHex?.toUpperCase() ?? t('cannotCalculateMix');

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${color.paints.length} ${t('usedPaints')}, ${resultLabel}`}
    >
      <View style={styles.body}>
        <View style={[styles.resultSwatch, { backgroundColor: resultHex ?? colors.chip }]} />
        <View style={styles.info}>
          <Text numberOfLines={1} style={styles.name}>{name}</Text>
          {visiblePaints.map((paint) => (
            <Text key={paint.paint_id} numberOfLines={1} style={styles.paintSummary}>
              {brandLabel(paint.brand)} · {paint.code} · {paintName(paint.name_ja, paint.name_en)} · {Math.round(paint.ratio * 100)}%
            </Text>
          ))}
          {hiddenCount > 0 ? <Text numberOfLines={1} style={styles.otherPaints}>{t('otherPaints', { count: hiddenCount })}</Text> : null}
        </View>
      </View>
      <View pointerEvents="none" style={styles.strip}>
        {color.paints.map((paint) => (
          <View
            key={paint.paint_id}
            style={[styles.stripSegment, { backgroundColor: paintHex(paint, colors.chip), flex: Math.max(paint.ratio, 0.0001) }]}
          />
        ))}
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  card: {
    minHeight: 100,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resultSwatch: { width: 72, height: 72, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  info: { flex: 1, justifyContent: 'center', gap: 2 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  paintSummary: { color: colors.textSecondary, fontSize: 12 },
  otherPaints: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  strip: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 6, flexDirection: 'row' },
  stripSegment: { minWidth: 1 },
});
