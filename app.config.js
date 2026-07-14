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
  userInterfaceStyle: 'automatic',
  ios: {
    ...config.ios,
    supportsTablet: false,
    bundleIdentifier: process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER || 'com.example.colorack',
    infoPlist: {
      NSCameraUsageDescription: '塗料の色の読み取りやバーコードスキャンのためにカメラを使用します',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    ...config.android,
    package: process.env.EXPO_PUBLIC_ANDROID_PACKAGE || 'com.example.colorack',
    versionCode: 7,
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
    [
      'expo-splash-screen',
      {
        backgroundColor: '#000000',
        image: './assets/splash-icon.png',
        imageWidth: 120,
        resizeMode: 'contain',
      },
    ],
    [
      'expo-camera',
      { recordAudioAndroid: false },
    ],
    [
      'expo-tracking-transparency',
      {
        userTrackingPermission: 'パーソナライズ広告の表示のために使用されます',
      },
    ],
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
