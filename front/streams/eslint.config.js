// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // dist build output; importHymns.js is a one-off local seed script (loads a
    // hymns.json that isn't checked in) — not part of the app bundle.
    ignores: ['dist/*', 'components/importHymns.js'],
  },
  {
    // Jest globals for test files + the jest setup file.
    files: ['**/__tests__/**/*.js', '**/*.test.js', 'jest.setup.js'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
  {
    // CI gates on errors. Keep the rules that catch *real bugs* as errors
    // (undefined refs, duplicate keys, bad hooks, unresolved imports — these have
    // all hidden actual crashes here) and demote purely stylistic ones to
    // warnings so formatting never blocks a push.
    rules: {
      'react/no-unescaped-entities': 'warn',
      'react/display-name': 'warn',
      'import/first': 'warn',
      'no-unused-expressions': 'warn',
    },
  },
]);
