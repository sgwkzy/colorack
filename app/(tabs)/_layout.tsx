// app/(tabs)/_layout.tsx
import { useRef, useState } from 'react';
import { TouchableOpacity, useWindowDimensions } from 'react-native';
import DrawerLayout from 'react-native-gesture-handler/DrawerLayout';
import { Tabs } from 'expo-router';
import { IconMenu3 } from '@tabler/icons-react-native';
import { t, useLocale } from '../../lib/i18n';
import { getRestoreTarget } from '../../lib/lastScreen';
import { useTheme } from '../../lib/theme';
import NavigationDrawer from '../../components/NavigationDrawer';
import BoxTitlePicker from '../../components/BoxTitlePicker';
import BoxOptions from '../../components/BoxOptions';
import KitBoxTitlePicker from '../../components/KitBoxTitlePicker';
import KitBoxOptions from '../../components/KitBoxOptions';
import { useModalOpen } from '../../lib/modalLock';

export default function TabsLayout() {
  useLocale(); // ロケール変更でタブ名(ヘッダー/ラベル)を再計算
  const { colors, isDark } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const modalOpen = useModalOpen();
  const drawerRef = useRef<DrawerLayout>(null);
  const { width } = useWindowDimensions();
  const restoreTarget = getRestoreTarget();
  return (
    <DrawerLayout
      ref={drawerRef}
      drawerWidth={Math.min(360, width * 0.82)}
      drawerPosition="left"
      drawerType="front"
      edgeWidth={48}
      overlayColor="transparent"
      drawerBackgroundColor={colors.surface}
      drawerLockMode={modalOpen ? 'locked-closed' : 'unlocked'}
      onDrawerStateChanged={(_state, willShow) => { if (willShow) setDrawerOpen(true); }}
      onDrawerOpen={() => setDrawerOpen(true)}
      onDrawerClose={() => setDrawerOpen(false)}
      renderNavigationView={() => <NavigationDrawer visible={drawerOpen} onClose={() => drawerRef.current?.closeDrawer()} />}
    >
    <Tabs
      initialRouteName={restoreTarget?.screen}
      screenOptions={{
      tabBarActiveTintColor: colors.primary,
      tabBarStyle: { display: 'none' },
      tabBarInactiveTintColor: colors.textFaint,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerShadowVisible: !isDark,
      headerLeft: () => <TouchableOpacity onPress={() => drawerRef.current?.openDrawer()} accessibilityRole="button" accessibilityLabel="Menu" hitSlop={12} style={{ marginLeft: 16 }}><IconMenu3 color={colors.text} size={26} /></TouchableOpacity>,
    }}>
      <Tabs.Screen
        name="owned"
        initialParams={restoreTarget?.screen === 'owned' && restoreTarget.boxId ? { boxId: restoreTarget.boxId } : undefined}
        options={{ headerTitle: () => <BoxTitlePicker />, headerRight: () => <BoxOptions /> }}
      />
      <Tabs.Screen
        name="kits"
        initialParams={restoreTarget?.screen === 'kits' && restoreTarget.boxId ? { boxId: restoreTarget.boxId } : undefined}
        options={{ headerTitle: () => <KitBoxTitlePicker />, headerRight: () => <KitBoxOptions /> }}
      />
      <Tabs.Screen name="used" options={{ title: t('statusUsedUp') }} />
      <Tabs.Screen name="completed" options={{ title: t('completedKits') }} />
      <Tabs.Screen name="favorites" options={{ title: t('favorites') }} />
      <Tabs.Screen name="wishlist" options={{ title: t('wishlist') }} />
      <Tabs.Screen name="catalog" options={{ title: t('catalog') }} />
      <Tabs.Screen name="settings" options={{ title: t('settings') }} />
    </Tabs>
    </DrawerLayout>
  );
}
