import { ReactNode, useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconAdjustmentsHorizontal, IconArrowsSort, IconPlus } from '@tabler/icons-react-native';
import { t } from '../lib/i18n';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import { useUiPrefs } from '../lib/uiPrefs';

interface Props {
  onFilter: () => void;
  onSort: () => void;
  onAdd: () => void;
  filterActive?: boolean;
}

function Action({ children, label, onPress }: { children: ReactNode; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {children}
    </TouchableOpacity>
  );
}

export default function ListActionBar({ onFilter, onSort, onAdd, filterActive = false }: Props) {
  const { colors } = useTheme();
  const { actionOrder } = useUiPrefs();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const actions = [
    <Action key="filter" label={t('filter')} onPress={onFilter}><IconAdjustmentsHorizontal color={filterActive ? colors.primary : colors.text} size={22} /></Action>,
    <Action key="sort" label={t('sort')} onPress={onSort}><IconArrowsSort color={colors.text} size={22} /></Action>,
    <Action key="add" label={t('add')} onPress={onAdd}><IconPlus color={colors.text} size={24} /></Action>,
  ];
  return (
    <View collapsable={false} pointerEvents="box-none" style={styles.overlay}>
      <SafeAreaView edges={['bottom']} style={styles.safeArea}><View style={styles.bar}>
        {actionOrder === 'reverse' ? actions.reverse() : actions}
      </View></SafeAreaView>
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20, elevation: 20 },
  safeArea: { backgroundColor: 'transparent', paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  bar: { flexDirection: 'row', minHeight: 56, padding: spacing.xs, gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.fab, backgroundColor: colors.surfaceAlt, boxShadow: '0 -2px 12px rgba(0, 0, 0, 0.12)' },
  action: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.fab },
});
