const ADMOB_APP_ID_IOS = process.env.EXPO_PUBLIC_ADMOB_APP_ID_IOS || 'ca-app-pub-3940256099942544~1458002511';
const ADMOB_APP_ID_ANDROID = process.env.EXPO_PUBLIC_ADMOB_APP_ID_ANDROID || 'ca-app-pub-3940256099942544~3347511713';
const ADMOB_BANNER_AD_UNIT_ID_IOS = process.env.EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_IOS || '';
const ADMOB_BANNER_AD_UNIT_ID_ANDROID = process.env.EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_ANDROID || '';

module.exports = ({ config }) => ({
  ...config,
  name: 'Colorack',
  slug: 'colorack',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    ...config.ios,
    supportsTablet: true,
    bundleIdentifier: process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER || 'com.example.colorack',
  },
  android: {
    ...config.android,
    package: process.env.EXPO_PUBLIC_ANDROID_PACKAGE || 'com.example.colorack',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    ...config.web,
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-sqlite',
    'expo-router',
    'expo-localization',
    'expo-camera',
    [
      'react-native-google-mobile-ads',
      {
        iosAppId: ADMOB_APP_ID_IOS,
        androidAppId: ADMOB_APP_ID_ANDROID,
      },
    ],
  ],
  scheme: 'colorack',
  extra: {
    ...config.extra,
    adMobBannerAdUnitIdIos: ADMOB_BANNER_AD_UNIT_ID_IOS,
    adMobBannerAdUnitIdAndroid: ADMOB_BANNER_AD_UNIT_ID_ANDROID,
  },
});
