// app/(tabs)/_layout.tsx
import { useCallback, useRef, useState } from 'react';
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
  const modalOpen = useModalOpen();
  const drawerRef = useRef<DrawerLayout>(null);
  const closeDrawer = useCallback(() => drawerRef.current?.closeDrawer(), []);
  // ドロワーを開いた回数。NavigationDrawer は常時マウントで再読込の契機が無いため、
  // これを渡して開く度に件数を取り直させる。
  const [drawerOpenCount, setDrawerOpenCount] = useState(0);
  const renderNavigationView = useCallback(
    () => <NavigationDrawer onClose={closeDrawer} refreshToken={drawerOpenCount} />,
    [closeDrawer, drawerOpenCount]
  );
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
      // onDrawerOpen ではなく 'Settling' で拾う。onDrawerOpen は開くアニメーションが
      // 完了してから呼ばれるため、開き始めから開き終わるまで古い件数が見えてしまう。
      // 'Settling' はアニメーション開始時なので、表示が完了するまでに取り直しが間に合う。
      // ('Idle' でも willShow は true になるが、そちらは完了後なので使わない)
      onDrawerStateChanged={(state, willShow) => {
        if (willShow && state === 'Settling') setDrawerOpenCount((n) => n + 1);
      }}
      renderNavigationView={renderNavigationView}
    >
    <Tabs
      initialRouteName={restoreTarget?.screen}
      screenOptions={{
      tabBarActiveTintColor: colors.primary,
      tabBarStyle: { display: 'none' },
      tabBarInactiveTintColor: colors.textFaint,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerTitleAlign: 'center',
      headerShadowVisible: !isDark,
      headerLeft: () => <TouchableOpacity onPress={() => drawerRef.current?.openDrawer()} accessibilityRole="button" accessibilityLabel={t('menu')} hitSlop={12} style={{ marginLeft: 16 }}><IconMenu3 color={colors.text} size={26} /></TouchableOpacity>,
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
      <Tabs.Screen name="kit-wishlist" options={{ title: t('kitWishlist') }} />
      <Tabs.Screen name="favorites" options={{ title: t('favorites') }} />
      <Tabs.Screen name="wishlist" options={{ title: t('wishlist') }} />
      <Tabs.Screen name="catalog" options={{ title: t('catalog') }} />
      <Tabs.Screen name="settings" options={{ title: t('settings') }} />
    </Tabs>
    </DrawerLayout>
  );
}
