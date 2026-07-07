import { useEffect, useReducer } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import { getSetting, setSetting } from './db';

export const lightColors = {
  primary: '#4a90d9',
  primarySoft: '#eef4fb',
  primaryDisabled: '#b7cde6',
  danger: '#e74c3c',
  dangerSoft: '#fdecea',
  inUse: '#b85a0a',
  usedUp: '#637273',
  favoriteAccent: '#b94f2f',
  wishlistAccent: '#6a5acd',
  typeLacquer: '#c0392b',
  typeAcrylic: '#2980b9',
  typeEnamel: '#27ae60',
  typeEmulsion: '#8e44ad',
  darkAction: '#34495e',
  neutralAction: '#7f8c8d',
  surface: '#fff',
  surfaceAlt: '#f5f5f5',
  chip: '#f0f0f0',
  chipAlt: '#e8e8e8',
  border: '#ccc',
  borderLight: '#eee',
  text: '#333',
  textSecondary: '#555',
  textMuted: '#666',
  textFaint: '#888',
  textPlaceholder: '#999',
  onPrimary: '#fff',
  transparent: 'transparent',
};

export const darkColors: typeof lightColors = {
  primary: '#5b9bdb',
  primarySoft: '#24384d',
  primaryDisabled: '#3a4a5a',
  danger: '#e74c3c',
  dangerSoft: '#3a2422',
  inUse: '#b85a0a',
  usedUp: '#637273',
  favoriteAccent: '#b9553d',
  wishlistAccent: '#6f62d7',
  typeLacquer: '#e74c3c',
  typeAcrylic: '#5dade2',
  typeEnamel: '#58d68d',
  typeEmulsion: '#bb8fce',
  darkAction: '#4a6178',
  neutralAction: '#95a5a6',
  surface: '#1c1c1e',
  surfaceAlt: '#2c2c2e',
  chip: '#2c2c2e',
  chipAlt: '#3a3a3c',
  border: '#48484a',
  borderLight: '#3a3a3c',
  text: '#f2f2f7',
  textSecondary: '#d1d1d6',
  textMuted: '#aeaeb2',
  textFaint: '#8e8e93',
  textPlaceholder: '#8e8e93',
  onPrimary: '#fff',
  transparent: 'transparent',
};

export type ThemeMode = 'light' | 'dark' | 'system';

export function resolveIsDark(mode: ThemeMode, systemScheme: ColorSchemeName): boolean {
  if (mode === 'light') return false;
  if (mode === 'dark') return true;
  return systemScheme === 'dark';
}

if (__DEV__) {
  console.assert(resolveIsDark('light', 'dark') === false, 'resolveIsDark: light mode must stay light');
  console.assert(resolveIsDark('dark', 'light') === true, 'resolveIsDark: dark mode must stay dark');
  console.assert(resolveIsDark('system', 'dark') === true, 'resolveIsDark: system mode should follow system (dark)');
  console.assert(resolveIsDark('system', 'light') === false, 'resolveIsDark: system mode should follow system (light)');
  console.assert(resolveIsDark('system', null) === false, 'resolveIsDark: system mode with unknown scheme falls back to light');
}

const THEME_MODE_KEY = 'theme_mode';
let currentMode: ThemeMode = 'system';
let systemScheme: ColorSchemeName = Appearance.getColorScheme();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

Appearance.addChangeListener(({ colorScheme }) => {
  systemScheme = colorScheme;
  if (currentMode === 'system') notify();
});

export async function initTheme(): Promise<void> {
  try {
    const saved = await getSetting(THEME_MODE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      currentMode = saved;
    }
  } catch (e) {
    console.error('initTheme: failed to load theme_mode, falling back to system', e);
  }
}

export function setThemeMode(mode: ThemeMode): void {
  currentMode = mode;
  notify();
  setSetting(THEME_MODE_KEY, mode).catch((e) => console.error('setThemeMode: failed to persist', e));
}

export function getThemeMode(): ThemeMode {
  return currentMode;
}

export function useTheme(): { colors: typeof lightColors; mode: ThemeMode; isDark: boolean } {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  const isDark = resolveIsDark(currentMode, systemScheme);
  return { colors: isDark ? darkColors : lightColors, mode: currentMode, isDark };
}

export const spacing = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
};

export const radius = {
  sm: 6,
  md: 8,
  pill: 16,
  fab: 28,
};

export const touch = {
  min: 44,
};
