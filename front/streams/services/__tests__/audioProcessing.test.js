// Verifies compressAudio()'s DECISIONS — target bitrate, the "only keep it if it
// actually shrank" guard, the tiny-file skip, and the fail-safe fallback — with
// the native encoder and the filesystem mocked (no real transcoding).
const mockSizes = {};
const mockCompress = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async (uri) => ({ size: mockSizes[uri] ?? 0 })),
}));
// `react-native-compressor` isn't installed until the native rebuild, so mock it
// virtually — this lets the test (and the fallback logic) run in CI regardless.
jest.mock(
  'react-native-compressor',
  () => ({ Audio: { compress: (...a) => mockCompress(...a) } }),
  { virtual: true }
);

const { compressAudio, isAudioCompressionAvailable, TARGET_BITRATE_BPS } = require('../audioProcessing');

const MB = 1024 * 1024;

beforeEach(() => {
  mockCompress.mockReset();
  for (const k of Object.keys(mockSizes)) delete mockSizes[k];
});

test('detects the (mocked) native module as available', () => {
  expect(isAudioCompressionAvailable()).toBe(true);
});

test('transcodes to the target bitrate and adopts a meaningfully smaller result', async () => {
  mockSizes['file://src.mp3'] = 10 * MB;
  mockSizes['file://out.m4a'] = 4 * MB;
  mockCompress.mockResolvedValue('file://out.m4a');

  const r = await compressAudio({ uri: 'file://src.mp3' });

  expect(mockCompress).toHaveBeenCalledWith('file://src.mp3', {
    quality: 'medium',
    bitrate: TARGET_BITRATE_BPS,
  });
  expect(r).toEqual({
    uri: 'file://out.m4a',
    compressed: true,
    originalSize: 10 * MB,
    finalSize: 4 * MB,
    savedPct: 60,
  });
});

test('keeps the crisp original when the re-encode saved (almost) nothing', async () => {
  mockSizes['file://src.m4a'] = 5 * MB;
  mockSizes['file://out.m4a'] = 5 * MB; // already low-bitrate → no real win
  mockCompress.mockResolvedValue('file://out.m4a');

  const r = await compressAudio({ uri: 'file://src.m4a' });

  expect(r.compressed).toBe(false);
  expect(r.uri).toBe('file://src.m4a');
});

test('skips tiny files without invoking the encoder', async () => {
  mockSizes['file://small.m4a'] = 0.5 * MB;

  const r = await compressAudio({ uri: 'file://small.m4a' });

  expect(mockCompress).not.toHaveBeenCalled();
  expect(r.compressed).toBe(false);
  expect(r.uri).toBe('file://small.m4a');
});

test('falls back to the original if the encoder throws', async () => {
  mockSizes['file://src.mp3'] = 10 * MB;
  mockCompress.mockRejectedValue(new Error('encoder boom'));

  const r = await compressAudio({ uri: 'file://src.mp3' });

  expect(r.compressed).toBe(false);
  expect(r.uri).toBe('file://src.mp3');
});
