const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

// Metro can start thousands of cache reads at once, exhausting Windows file handles.
if (process.platform === 'win32') {
  const limitMetroCache = require('./lib/limitMetroCache.cjs');
  config.cacheStores = config.cacheStores.map((store) => limitMetroCache(store));
}

const defaultBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(defaultBlockList) ? defaultBlockList : [defaultBlockList]),
  /[/\\]node_modules[/\\](?:@[^/\\]+[/\\])?[^/\\]+[/\\](?:android|ios|windows|macos)(?:[/\\]|$)/,
  /[/\\]node_modules[/\\]react-native[/\\](?:ReactAndroid|ReactCommon|React|ReactApple|types_generated)(?:[/\\]|$)/,
  // Firebase duplicates declaration-only folders under each distribution entry.
  /[/\\]node_modules[/\\]firebase[/\\](?:compat[/\\])?[^/\\]+[/\\]dist[/\\](?:esm[/\\])?(?:ai|analytics|app|app-check|auth|compat|data-connect|database|firestore|functions|installations|messaging|performance|remote-config|storage)(?:[/\\]|$)/,
  /[/\\]\.superpowers(?:[/\\]|$)/,
].filter(Boolean);

module.exports = config;
