import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View collapsable={false} pointerEvents="box-none" style={styles.overlay}>
      <SafeAreaView edges={['bottom']} pointerEvents="box-none" style={[styles.safeArea, fabSide === 'left' ? styles.safeAreaLeft : styles.safeAreaRight]}>
        <TouchableOpacity style={styles.fab} onPress={onAdd} accessibilityRole="button" accessibilityLabel={t('add')}>
          <IconPlus color={colors.onPrimary} size={28} />
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20, elevation: 20 },
  safeArea: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  safeAreaLeft: { alignItems: 'flex-start' },
  safeAreaRight: { alignItems: 'flex-end' },
  fab: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: radius.fab, backgroundColor: colors.primary, boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)' },
  toolbar: { flexDirection: 'row', gap: spacing.sm },
  toolbarAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  toolbarText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  toolbarTextActive: { color: colors.primaryText },
});
