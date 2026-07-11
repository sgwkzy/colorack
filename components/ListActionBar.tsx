import { ReactNode, useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconAdjustmentsHorizontal, IconArrowsSort, IconPlus } from '@tabler/icons-react-native';
import { t } from '../lib/i18n';
import { lightColors, spacing, touch, useTheme } from '../lib/theme';
import { useUiPrefs } from '../lib/uiPrefs';

interface Props {
  onFilter: () => void;
  onSort: () => void;
  onAdd: () => void;
  filterActive?: boolean;
}

function Action({ children, label, onPress, primary = false }: { children: ReactNode; label: string; onPress: () => void; primary?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity style={[styles.action, primary && styles.primaryAction]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
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
    <Action key="add" label={t('add')} onPress={onAdd} primary><IconPlus color={colors.onPrimary} size={24} /></Action>,
  ];
  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}><View style={styles.bar}>
      {actionOrder === 'reverse' ? actions.reverse() : actions}
    </View></SafeAreaView>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  bar: { flexDirection: 'row', minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
  safeArea: { backgroundColor: colors.surface },
  action: { flex: 1, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.borderLight },
  primaryAction: { backgroundColor: colors.primary, borderRightWidth: 0 },
});
