import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconPlus } from '@tabler/icons-react-native';
import { t } from '../lib/i18n';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import { useUiPrefs } from '../lib/uiPrefs';

interface Props {
  onAdd: () => void;
}

export function ListToolbar({ onFilter, onSort, filterActive = false }: { onFilter: () => void; onSort: () => void; filterActive?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.toolbar}>
      <TouchableOpacity style={styles.toolbarAction} onPress={onFilter} accessibilityRole="button">
        <Text style={[styles.toolbarText, filterActive && styles.toolbarTextActive]} numberOfLines={1}>{t('filter')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.toolbarAction} onPress={onSort} accessibilityRole="button">
        <Text style={styles.toolbarText} numberOfLines={1}>{t('sort')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ListActionBar({ onAdd }: Props) {
  const { colors } = useTheme();
  const { fabSide } = useUiPrefs();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // FAB_DIAG: 一時的な計測用の state。原因特定後に削除する。
  const win = useWindowDimensions();
  const [fabLayout, setFabLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [taps, setTaps] = useState({ in: 0, press: 0 });
  // ponytail: FABだけを絶対配置する。以前は全幅の透明ViewとSafeAreaViewで包んでいたが、
  // 見えないタッチ面を画面下部の全幅に敷くことになり、pointerEvents="box-none"が
  // 効かないと下部全域(背後のリスト行を含む)が反応しなくなる。ラッパーを無くして
  // その前提自体を排除する。safe areaはinsetsで直接オフセットする。
  return (
    <>
      {/* FAB_DIAG: 画面下部のタッチ不能化を発生環境で実測するための一時的な表示。
          原因が特定できたら削除する。pointerEvents="none" なので操作を邪魔しない。 */}
      <View pointerEvents="none" style={styles.diagBox}>
        <Text style={styles.diagText}>
          win {Math.round(win.width)}x{Math.round(win.height)} insB {Math.round(insets.bottom)} side {fabSide}
        </Text>
        <Text style={styles.diagText}>
          fab {fabLayout ? `x${Math.round(fabLayout.x)} y${Math.round(fabLayout.y)} w${Math.round(fabLayout.width)} h${Math.round(fabLayout.height)}` : '-'}
        </Text>
        <Text style={styles.diagText}>in {taps.in} / press {taps.press}</Text>
      </View>
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + spacing.md }, fabSide === 'left' ? styles.fabLeft : styles.fabRight]}
        onPress={() => { setTaps((p) => ({ ...p, press: p.press + 1 })); onAdd(); }}
        onPressIn={() => setTaps((p) => ({ ...p, in: p.in + 1 }))}
        onLayout={(e) => setFabLayout(e.nativeEvent.layout)}
        accessibilityRole="button"
        accessibilityLabel={t('add')}
      >
        <IconPlus color={colors.onPrimary} size={28} />
      </TouchableOpacity>
    </>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  fab: { position: 'absolute', zIndex: 20, elevation: 20, width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: radius.fab, backgroundColor: colors.primary, boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)' },
  // FAB_DIAG: 一時的な診断表示。原因特定後に削除する。
  diagBox: { position: 'absolute', left: 4, right: 4, bottom: 104, zIndex: 21, backgroundColor: 'rgba(0,0,0,0.75)', padding: 4, borderRadius: 4 },
  diagText: { color: '#0f0', fontSize: 10, fontVariant: ['tabular-nums'] },
  fabLeft: { left: spacing.xl },
  fabRight: { right: spacing.xl },
  toolbar: { flexDirection: 'row', gap: spacing.sm },
  toolbarAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  toolbarText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  toolbarTextActive: { color: colors.primaryText },
});
