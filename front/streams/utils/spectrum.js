// The spectrum visualizer's data (made on the server when a song is
// processed — songs/audio_processing.spectrum): each of `bands` frequency
// bands, bass to treble, `fps` times a second, one byte (0..255) each.
//
//   { v: 1, fps: 10, bands: 16, frames: N, data: base64(N × bands bytes) }
//
// Plain JS: a small base64 decoder of its own rather than relying on atob,
// which not every React Native engine provides.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const t = new Uint8Array(128).fill(255);
  for (let i = 0; i < ALPHABET.length; i += 1) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export const decodeBase64 = (text) => {
  const clean = String(text || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    buf = (buf << 6) | LOOKUP[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (buf >> bits) & 0xff;
      o += 1;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
};

/** The file's JSON → { fps, bands, frames, levels: Uint8Array }, or null when
 *  it isn't one we understand (a newer format, a truncated download). */
export const parseSpectrum = (json) => {
  if (!json || json.v !== 1) return null;
  const fps = Number(json.fps);
  const bands = Number(json.bands);
  if (!(fps > 0) || !(bands > 0)) return null;
  const levels = decodeBase64(json.data);
  const frames = Math.floor(levels.length / bands);
  if (!frames) return null;
  return { fps, bands, frames, levels };
};

/**
 * Each band's level (0..1) at `ms` into the song, blended between the two
 * nearest frames so the bars glide instead of stepping 10 times a second.
 * Writes into `out` (reused every animation frame: no garbage) and returns it.
 */
export const levelsAt = (spec, ms, out = new Float32Array(spec.bands)) => {
  const { fps, bands, frames, levels } = spec;
  const pos = Math.max(0, (ms / 1000) * fps);
  const a = Math.min(frames - 1, Math.floor(pos));
  const b = Math.min(frames - 1, a + 1);
  const mix = Math.min(1, pos - a);
  for (let i = 0; i < bands; i += 1) {
    out[i] = (levels[a * bands + i] * (1 - mix) + levels[b * bands + i] * mix) / 255;
  }
  return out;
};
