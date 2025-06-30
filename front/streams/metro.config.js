const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add db extension support
config.resolver.assetExts.push(
  'db',
  'sqlite'
);

module.exports = config;