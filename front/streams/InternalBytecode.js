// Intentionally (almost) empty.
//
// Hermes attributes some stack frames to a virtual file named
// "InternalBytecode.js" that doesn't exist on disk. When Metro's symbolicator
// tries to build a code frame for such a stack, it does fs.readFileSync() on
// this path and throws ENOENT, spamming the dev-server terminal with errors
// (purely a dev-server artifact — it never affects the app or a release build).
//
// Providing an empty file here makes that read succeed, silencing the noise.
// Nothing imports this module, so it is never bundled.
