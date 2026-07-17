const isProductionBuild = process.env.EAS_BUILD_PROFILE === 'production';
function env(name, fallback) {
  const value = process.env[name];
  if (value) return value;
  if (isProductionBuild) throw new Error(`app.config.js: production build requires ${name}`);
  return fallback;
}

const ADMOB_APP_ID_IOS = env('EXPO_PUBLIC_ADMOB_APP_ID_IOS', 'ca-app-pub-3940256099942544~1458002511');
const ADMOB_APP_ID_ANDROID = env('EXPO_PUBLIC_ADMOB_APP_ID_ANDROID', 'ca-app-pub-3940256099942544~3347511713');
const ADMOB_BANNER_AD_UNIT_ID_IOS = env('EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_IOS', '');
const ADMOB_BANNER_AD_UNIT_ID_ANDROID = env('EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_ANDROID', '');

module.exports = ({ config }) => ({
  ...config,
  name: 'Colorack',
  slug: 'colorack',
  version: '1.1.2',
  orientation: 'portrait',
  backgroundColor: '#172033',
  icon: './assets/icon-ios.png',
  userInterfaceStyle: 'automatic',
  ios: {
    ...config.ios,
    supportsTablet: false,
    bundleIdentifier: env('EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER', 'com.example.colorack'),
    infoPlist: {
      NSCameraUsageDescription: '塗料の色の読み取りやバーコードスキャンのためにカメラを使用します',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    ...config.android,
    package: env('EXPO_PUBLIC_ANDROID_PACKAGE', 'com.example.colorack'),
    versionCode: 11,
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
      'expo-media-library',
      {
        savePhotosPermission: 'キット写真を写真ライブラリに保存するために使用します',
        granularPermissions: ['photo'],
      },
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
