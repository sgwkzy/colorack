// components/KitColorRow.tsx
// 色詳細画面と同様、混色後のHEXを背景に敷いてその上に色名・構成塗料を重ねて表示する。
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconCheck, IconChevronLeft, IconChevronRight, IconTrash } from '@tabler/icons-react-native';
import { KitColorSummary } from '../lib/db';
import { brandLabel } from '../lib/brands';
import { readableTextColor } from '../lib/color';
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
  // falseの間は名前編集欄・削除/並び替えボタンを隠す(閲覧のみ)。
  editable: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  // 構成塗料のうち所有している(在庫あり)ものにチェックマークを付けるための所有数マップ。
  ownedMap: Map<number, number>;
}

export default function KitColorRow({ color, onNameChange, onRemove, onMove, editable, canMoveLeft, canMoveRight, ownedMap }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState(color.name ?? '');
  const [tooltipPaintId, setTooltipPaintId] = useState<number | null>(null);

  const swatchHex = useMemo(() => mixHexColors(
    color.paints.filter((p) => p.hex).map((p) => ({ hex: p.hex as string, ratio: p.ratio }))
  ), [color.paints]);
  const textColor = swatchHex ? readableTextColor(swatchHex) : colors.text;
  // 色詳細画面のタップツールチップと同じく、スウォッチの明暗に応じて背景を反転させる。
  const tooltipBackground = swatchHex
    ? (textColor === '#fff' ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.92)')
    : colors.surface;

  const fallbackName = color.paints[0] ? paintName(color.paints[0].name_ja, color.paints[0].name_en) : '';
  return (
    <View style={styles.row}>
      <View style={[styles.swatch, { backgroundColor: swatchHex ?? colors.surfaceAlt }]}>
        <Text numberOfLines={1} style={[styles.swatchName, { color: textColor }]}>
          {name || fallbackName || t('colorNameLabel')}
        </Text>
        {color.paints.map((p) => (
          <View key={p.paint_id} style={styles.paintLineWrap}>
            <TouchableOpacity
              style={styles.paintLine}
              onPress={() => setTooltipPaintId((current) => (current === p.paint_id ? null : p.paint_id))}
              accessibilityRole="button"
              accessibilityLabel={`${brandLabel(p.brand)} ${paintName(p.name_ja, p.name_en)}`}
            >
              <View style={styles.checkSlot}>
                {(ownedMap.get(p.paint_id) ?? 0) > 0 ? <IconCheck color={textColor} size={13} /> : null}
              </View>
              <Text numberOfLines={1} style={[styles.paintLineText, { color: textColor }]}>
                {paintName(p.name_ja, p.name_en)} {Math.round(p.ratio * 100)}%
              </Text>
            </TouchableOpacity>
            {tooltipPaintId === p.paint_id ? (
              <TouchableOpacity
                style={[styles.paintTooltip, { backgroundColor: tooltipBackground }]}
                onPress={() => setTooltipPaintId(null)}
                accessibilityRole="button"
                accessibilityLabel={t('cancel')}
              >
                <Text selectable style={[styles.paintTooltipBrand, { color: textColor }]}>{brandLabel(p.brand)}</Text>
                <Text selectable style={[styles.paintTooltipName, { color: textColor }]}>{paintName(p.name_ja, p.name_en)}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
      </View>
      {editable ? (
        <View style={styles.editControls}>
          <ClearableInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            onBlur={() => onNameChange(name)}
            placeholder={fallbackName || t('colorNameLabel')}
          />
          <View style={styles.editButtonsRow}>
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
            <TouchableOpacity style={styles.deleteBtn} onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('delete')}>
              <IconTrash color={colors.danger} size={20} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  row: { borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight },
  swatch: { padding: spacing.lg, gap: spacing.xs },
  swatchName: { fontSize: 17, fontWeight: '700' },
  paintLineWrap: { position: 'relative' },
  paintLine: { flexDirection: 'row', alignItems: 'center' },
  checkSlot: { width: 18, alignItems: 'center' },
  paintLineText: { fontSize: 13, fontWeight: '600' },
  // タップした塗料の行のすぐ下に重ねて表示。他の行を押し下げない。タップで閉じられる。
  paintTooltip: { position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, zIndex: 2 },
  paintTooltipBrand: { fontSize: 11, fontWeight: '700', opacity: 0.85 },
  paintTooltipName: { fontSize: 13, fontWeight: '600' },
  editControls: { backgroundColor: colors.surfaceAlt, padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight },
  nameInput: { minHeight: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text, fontSize: 15, fontWeight: '600' },
  editButtonsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  moveBtn: { width: touch.min, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  moveBtnDisabled: { opacity: 0.4 },
  deleteBtn: { marginLeft: 'auto', padding: spacing.xs },
});
