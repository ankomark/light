// metro.config.js
const { getDefaultConfig } = require('@expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add SQLite/database extensions
config.resolver.assetExts.push(
  'db',
  'sqlite'
);

module.exports = config;