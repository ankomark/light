/**
 * Runtime polyfills that must load before any other module.
 *
 * Hermes doesn't define `DOMException`, but livekit-client / WebRTC reference it
 * (e.g. when constructing media errors). Without this, the app throws
 * "ReferenceError: Property 'DOMException' doesn't exist" at startup, before
 * anything renders. Define a minimal Error-based shim if it's missing.
 */
if (typeof global.DOMException === 'undefined') {
  class DOMException extends Error {
    constructor(message, name) {
      super(message);
      this.name = name || 'DOMException';
    }
  }
  global.DOMException = DOMException;
}
