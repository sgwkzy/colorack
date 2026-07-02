// app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import { IconBox, IconHeart, IconShoppingCartPlus, IconSettings, IconPalette } from '@tabler/icons-react-native';
import { t, useLocale } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';

export default function TabsLayout() {
  useLocale(); // ロケール変更でタブ名(ヘッダー/ラベル)を再計算
  const { colors, isDark } = useTheme();
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: colors.primary,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.borderLight },
      tabBarInactiveTintColor: colors.textFaint,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerShadowVisible: !isDark,
    }}>
      <Tabs.Screen name="owned" options={{ title: t('owned'), tabBarIcon: ({ color, size }) => <IconBox color={color} size={size} /> }} />
      <Tabs.Screen name="favorites" options={{ title: t('favorites'), tabBarIcon: ({ color, size }) => <IconHeart color={color} size={size} /> }} />
      <Tabs.Screen name="wishlist" options={{ title: t('wishlist'), tabBarIcon: ({ color, size }) => <IconShoppingCartPlus color={color} size={size} /> }} />
      <Tabs.Screen name="catalog" options={{ title: t('catalog'), tabBarIcon: ({ color, size }) => <IconPalette color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: t('settings'), tabBarIcon: ({ color, size }) => <IconSettings color={color} size={size} /> }} />
    </Tabs>
  );
}
