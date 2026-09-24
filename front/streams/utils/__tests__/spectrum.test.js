import { decodeBase64, parseSpectrum, levelsAt } from '../spectrum';

const b64 = (bytes) => Buffer.from(Uint8Array.from(bytes)).toString('base64');

test('base64 decodes like the server encoded it, padding or not', () => {
  const bytes = Array.from({ length: 257 }, (_, i) => (i * 37) % 256);
  expect(Array.from(decodeBase64(b64(bytes)))).toEqual(bytes);
  expect(Array.from(decodeBase64('AAEC'))).toEqual([0, 1, 2]);
  expect(Array.from(decodeBase64('AAE='))).toEqual([0, 1]);
  expect(Array.from(decodeBase64('AA=='))).toEqual([0]);
});

test('a file we understand parses; anything else is null', () => {
  const spec = parseSpectrum({ v: 1, fps: 10, bands: 2, frames: 3, data: b64([0, 255, 51, 102, 255, 0]) });
  expect([spec.fps, spec.bands, spec.frames, Array.from(spec.levels)]).toEqual([10, 2, 3, [0, 255, 51, 102, 255, 0]]);
  expect(parseSpectrum(null)).toBeNull();
  expect(parseSpectrum({ v: 2, fps: 10, bands: 2, data: 'AAAA' })).toBeNull();     // a newer format
  expect(parseSpectrum({ v: 1, fps: 10, bands: 2, data: '' })).toBeNull();         // no frames
});

test('levels glide between frames and hold at the end', () => {
  const spec = parseSpectrum({ v: 1, fps: 10, bands: 2, data: b64([0, 255, 255, 0, 51, 51]) });
  const at = (ms) => Array.from(levelsAt(spec, ms)).map((v) => Math.round(v * 100) / 100);
  expect(at(0)).toEqual([0, 1]);
  expect(at(50)).toEqual([0.5, 0.5]);          // halfway between frame 0 and 1
  expect(at(100)).toEqual([1, 0]);
  expect(at(60000)).toEqual([0.2, 0.2]);       // past the end: the last frame
  const out = new Float32Array(2);
  expect(levelsAt(spec, 0, out)).toBe(out);    // reuses the buffer it's given
});
