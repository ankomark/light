/**
 * Runs before every EAS build (package.json "eas-build-pre-install").
 *
 * A release build must know the server it talks to: EXPO_PUBLIC_API_BASE
 * (eas.json, per profile) is the API on the Hetzner box, e.g.
 * https://api.example.com. A build left on the placeholder - or with no
 * address, or plain http - would ship an app that cannot reach anything, so
 * it stops here instead. Development builds (local dev server) are not
 * checked.
 */
const profile = process.env.EAS_BUILD_PROFILE || '';
const RELEASE = ['production', 'preview'];

if (!RELEASE.includes(profile)) {
  console.log(`[release-config] profile "${profile || 'local'}": not a release build, not checked.`);
  process.exit(0);
}

const problems = [];
for (const name of ['EXPO_PUBLIC_API_BASE', 'EXPO_PUBLIC_PUBLIC_BASE']) {
  const value = process.env[name] || '';
  if (!value) problems.push(`${name} is not set`);
  else if (/YOUR-DOMAIN|example\.com/i.test(value)) problems.push(`${name} is still the placeholder (${value})`);
  else if (!value.startsWith('https://')) problems.push(`${name} must be https:// (${value})`);
  else if (value.endsWith('/')) problems.push(`${name} must not end with "/" (${value})`);
}

if (problems.length) {
  console.error(`[release-config] ${profile} build stopped:\n  - ${problems.join('\n  - ')}`);
  console.error('Set them in eas.json (build.<profile>.env) to the API address of the Hetzner server.');
  process.exit(1);
}
console.log(`[release-config] ${profile}: API ${process.env.EXPO_PUBLIC_API_BASE}`);
