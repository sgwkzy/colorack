const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

const defaultBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(defaultBlockList) ? defaultBlockList : [defaultBlockList]),
  /[/\\]node_modules[/\\].*[/\\](?:android|ios|windows|macos)(?:[/\\]|$)/,
  /[/\\]\.superpowers(?:[/\\]|$)/,
].filter(Boolean);

module.exports = config;
