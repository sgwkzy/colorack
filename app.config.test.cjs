const assert = require('node:assert/strict');
const test = require('node:test');

test('Firebase file environment variables override gitignored local files', () => {
  process.env.GOOGLE_SERVICES_JSON = '/eas/google-services.json';
  process.env.GOOGLE_SERVICE_INFO_PLIST = '/eas/GoogleService-Info.plist';
  delete require.cache[require.resolve('./app.config.js')];
  const resolveConfig = require('./app.config.js');
  const config = resolveConfig({
    config: {
      ios: { googleServicesFile: './GoogleService-Info.plist' },
      android: { googleServicesFile: './google-services.json' },
      extra: {},
    },
  });

  assert.equal(config.android.googleServicesFile, '/eas/google-services.json');
  assert.equal(config.ios.googleServicesFile, '/eas/GoogleService-Info.plist');
});

test('production Android config rejects a missing Firebase file variable', () => {
  Object.assign(process.env, {
    EAS_BUILD_PROFILE: 'production',
    EAS_BUILD_PLATFORM: 'android',
    EXPO_PUBLIC_ADMOB_APP_ID_IOS: 'ios-app',
    EXPO_PUBLIC_ADMOB_APP_ID_ANDROID: 'android-app',
    EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_IOS: 'ios-banner',
    EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_ANDROID: 'android-banner',
    EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER: 'com.example.ios',
    EXPO_PUBLIC_ANDROID_PACKAGE: 'com.example.android',
    EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID: 'web-client',
    EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID: 'revenuecat-key',
  });
  delete process.env.GOOGLE_SERVICES_JSON;
  delete require.cache[require.resolve('./app.config.js')];

  assert.throws(() => require('./app.config.js'), /GOOGLE_SERVICES_JSON/);

  delete process.env.EAS_BUILD_PROFILE;
  delete process.env.EAS_BUILD_PLATFORM;
});
