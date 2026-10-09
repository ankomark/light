#!/usr/bin/env node
/**
 * Day-to-day development without EAS builds: the development build on the
 * phone loads the JavaScript from this computer, so a saved change shows on
 * the phone in seconds. This picks which server that app talks to.
 *
 *   npm run dev:server   the Hetzner server (https://api.adventistlife.app)
 *   npm run dev:local    the Django dev server on this computer (:8000)
 *
 * Add --tunnel (npm run dev:server -- --tunnel) when the phone is not on the
 * same Wi-Fi as this computer.
 *
 * Only JavaScript changes arrive this way. A new native module, permission,
 * icon or app.json plugin still needs a new development build
 * (eas build -p android --profile development), once.
 */
const { spawn } = require('child_process');

const SERVER = 'https://api.adventistlife.app';
const [target = 'server', ...rest] = process.argv.slice(2);
const env = { ...process.env };

if (target === 'server') {
  env.EXPO_PUBLIC_API_BASE = SERVER;
  env.EXPO_PUBLIC_PUBLIC_BASE = SERVER;
} else if (target === 'local') {
  // services/api.js finds this computer's address from Metro's own.
  delete env.EXPO_PUBLIC_API_BASE;
  delete env.EXPO_PUBLIC_PUBLIC_BASE;
} else {
  console.error(`Unknown target "${target}": use "server" or "local".`);
  process.exit(2);
}

console.log(`[dev] API: ${env.EXPO_PUBLIC_API_BASE || 'this computer, port 8000'}`);
// --clear: EXPO_PUBLIC_* values are inlined into the bundle, so switching
// servers must not reuse a bundle built for the other one.
const child = spawn('npx', ['expo', 'start', '--dev-client', '--clear', ...rest], {
  stdio: 'inherit', env, shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 0));
