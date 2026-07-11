// app/(tabs)/_layout.tsx
import { useMemo, useState } from 'react';
import { GestureResponderEvent, PanResponder, PanResponderGestureState, TouchableOpacity, View } from 'react-native';
import { Tabs } from 'expo-router';
import { IconMenu3 } from '@tabler/icons-react-native';
import { t, useLocale } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';
import NavigationDrawer from '../../components/NavigationDrawer';
import BoxTitlePicker from '../../components/BoxTitlePicker';
import { useModalOpen } from '../../lib/modalLock';

export default function TabsLayout() {
  useLocale(); // ロケール変更でタブ名(ヘッダー/ラベル)を再計算
  const { colors, isDark } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const modalOpen = useModalOpen();
  const edgeSwipe = useMemo(() => {
    const shouldOpenDrawer = (event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      const startX = event.nativeEvent.pageX - gesture.dx;
      return !modalOpen && startX <= 32 && gesture.dx > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy);
    };
    return PanResponder.create({
    onMoveShouldSetPanResponder: shouldOpenDrawer,
    onMoveShouldSetPanResponderCapture: shouldOpenDrawer,
    onPanResponderRelease: (_event, gesture) => { if (gesture.dx > 56) setDrawerOpen(true); },
  });
  }, [modalOpen]);
  return (
    <View style={{ flex: 1 }} {...edgeSwipe.panHandlers}>
    <Tabs screenOptions={{
      tabBarActiveTintColor: colors.primary,
      tabBarStyle: { display: 'none' },
      tabBarInactiveTintColor: colors.textFaint,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerShadowVisible: !isDark,
      headerLeft: () => <TouchableOpacity onPress={() => setDrawerOpen(true)} accessibilityRole="button" accessibilityLabel="Menu" hitSlop={12} style={{ marginLeft: 16 }}><IconMenu3 color={colors.text} size={26} /></TouchableOpacity>,
    }}>
      <Tabs.Screen name="owned" options={{ headerTitle: () => <BoxTitlePicker /> }} />
      <Tabs.Screen name="used" options={{ title: t('statusUsedUp') }} />
      <Tabs.Screen name="favorites" options={{ title: t('favorites') }} />
      <Tabs.Screen name="wishlist" options={{ title: t('wishlist') }} />
      <Tabs.Screen name="catalog" options={{ title: t('catalog') }} />
      <Tabs.Screen name="settings" options={{ title: t('settings') }} />
    </Tabs>
    <NavigationDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </View>
  );
}
