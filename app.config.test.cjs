const assert = require('node:assert/strict');
const test = require('node:test');

function setTestEnvironment(t, values) {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve('./app.config.js')];
  });
}

test('Firebase file environment variables override gitignored local files', (t) => {
  setTestEnvironment(t, {
    GOOGLE_SERVICES_JSON: '/eas/google-services.json',
    GOOGLE_SERVICE_INFO_PLIST: '/eas/GoogleService-Info.plist',
  });
  delete require.cache[require.resolve('./app.config.js')];
  const resolveConfig = require('./app.config.js');
  const config = resolveConfig({
    config: {
      ios: { googleServicesFile: './GoogleService-Info.plist', usesAppleSignIn: true },
      android: { googleServicesFile: './google-services.json' },
      extra: {},
    },
  });

  assert.equal(config.android.googleServicesFile, '/eas/google-services.json');
  assert.equal(config.ios.googleServicesFile, '/eas/GoogleService-Info.plist');
  assert.equal(config.ios.usesAppleSignIn, true);
  assert.ok(config.plugins.includes('expo-apple-authentication'));
});

test('production Android config rejects a missing Firebase file variable', (t) => {
  setTestEnvironment(t, {
    EAS_BUILD: 'true',
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
    GOOGLE_SERVICES_JSON: undefined,
  });
  delete require.cache[require.resolve('./app.config.js')];

  assert.throws(() => require('./app.config.js'), /GOOGLE_SERVICES_JSON/);
});

test('production iOS config rejects a missing RevenueCat API key', (t) => {
  setTestEnvironment(t, {
    EAS_BUILD: 'true',
    EAS_BUILD_PROFILE: 'production',
    EAS_BUILD_PLATFORM: 'ios',
    EXPO_PUBLIC_ADMOB_APP_ID_IOS: 'ios-app',
    EXPO_PUBLIC_ADMOB_APP_ID_ANDROID: 'android-app',
    EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_IOS: 'ios-banner',
    EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_ANDROID: 'android-banner',
    EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER: 'com.example.ios',
    EXPO_PUBLIC_ANDROID_PACKAGE: 'com.example.android',
    EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID: 'web-client',
    EXPO_PUBLIC_REVENUECAT_API_KEY_IOS: undefined,
    GOOGLE_SERVICE_INFO_PLIST: '/eas/GoogleService-Info.plist',
  });
  delete require.cache[require.resolve('./app.config.js')];

  assert.throws(() => require('./app.config.js'), /EXPO_PUBLIC_REVENUECAT_API_KEY_IOS/);
});

test('production iOS config rejects a missing Firebase plist variable', (t) => {
  setTestEnvironment(t, {
    EAS_BUILD: 'true',
    EAS_BUILD_PROFILE: 'production',
    EAS_BUILD_PLATFORM: 'ios',
    EXPO_PUBLIC_ADMOB_APP_ID_IOS: 'ios-app',
    EXPO_PUBLIC_ADMOB_APP_ID_ANDROID: 'android-app',
    EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_IOS: 'ios-banner',
    EXPO_PUBLIC_ADMOB_BANNER_AD_UNIT_ID_ANDROID: 'android-banner',
    EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER: 'com.example.ios',
    EXPO_PUBLIC_ANDROID_PACKAGE: 'com.example.android',
    EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID: 'web-client',
    EXPO_PUBLIC_REVENUECAT_API_KEY_IOS: 'revenuecat-key',
    GOOGLE_SERVICE_INFO_PLIST: undefined,
  });
  delete require.cache[require.resolve('./app.config.js')];

  assert.throws(() => require('./app.config.js'), /GOOGLE_SERVICE_INFO_PLIST/);
});
