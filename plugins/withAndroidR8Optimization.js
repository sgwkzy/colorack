const { withAppBuildGradle } = require('@expo/config-plugins');

function enableOptimizedProguard(contents) {
  const legacy = 'getDefaultProguardFile("proguard-android.txt")';
  const optimized = 'getDefaultProguardFile("proguard-android-optimize.txt")';
  if (contents.includes(optimized)) return contents;
  if (!contents.includes(legacy)) {
    throw new Error('withAndroidR8Optimization: default ProGuard file not found');
  }
  return contents.replace(legacy, optimized);
}

module.exports = function withAndroidR8Optimization(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withAndroidR8Optimization: build.gradle が groovy ではない');
    }
    cfg.modResults.contents = enableOptimizedProguard(cfg.modResults.contents);
    return cfg;
  });
};
