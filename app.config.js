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

if (isProductionBuild) {
  env('EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID', '');
  if (process.env.EAS_BUILD_PLATFORM === 'ios') {
    env('EXPO_PUBLIC_REVENUECAT_API_KEY_IOS', '');
    env('GOOGLE_SERVICE_INFO_PLIST', '');
  } else if (process.env.EAS_BUILD_PLATFORM === 'android') {
    env('EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID', '');
    env('GOOGLE_SERVICES_JSON', '');
  }
}

module.exports = ({ config }) => ({
  ...config,
  name: 'Colorack',
  slug: 'colorack',
  orientation: 'portrait',
  backgroundColor: '#172033',
  icon: './assets/icon-ios.png',
  userInterfaceStyle: 'automatic',
  ios: {
    ...config.ios,
    supportsTablet: false,
    bundleIdentifier: env('EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER', 'com.example.colorack'),
    googleServicesFile: process.env.GOOGLE_SERVICE_INFO_PLIST ?? config.ios?.googleServicesFile,
    infoPlist: {
      NSCameraUsageDescription: '塗料の色を読み取るためにカメラを使用します',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    ...config.android,
    package: env('EXPO_PUBLIC_ANDROID_PACKAGE', 'com.example.colorack'),
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile,
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
        // このアプリは写真ライブラリへの「保存」しか行わない(requestPermissionsAsync(true) の
        // writeOnly)。expo-media-library のネイティブ実装は writeOnly のとき
        // READ_MEDIA_IMAGES を実行時に要求しないので、manifest からも出さない。
        // 残したままだと Google Play の写真/動画ポリシーに抵触して審査に出せない。
        granularPermissions: [],
      },
    ],
    [
      'expo-tracking-transparency',
      {
        userTrackingPermission: 'パーソナライズ広告の表示のために使用されます',
      },
    ],
    '@react-native-firebase/app',
    '@react-native-google-signin/google-signin',
    [
      'react-native-google-mobile-ads',
      {
        iosAppId: ADMOB_APP_ID_IOS,
        androidAppId: ADMOB_APP_ID_ANDROID,
      },
    ],
    // Androidのリリース署名を build.gradle へ注入する。これにより
    // expo prebuild --clean を安全に再実行でき、上のプラグイン設定や
    // app.json のバージョンが Android ビルドへ確実に反映される。
    './plugins/withAndroidReleaseSigning',
  ],
  scheme: 'colorack',
  extra: {
    ...config.extra,
    adMobBannerAdUnitIdIos: ADMOB_BANNER_AD_UNIT_ID_IOS,
    adMobBannerAdUnitIdAndroid: ADMOB_BANNER_AD_UNIT_ID_ANDROID,
  },
});
