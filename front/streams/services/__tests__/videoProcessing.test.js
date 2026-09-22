// Verifies processVideo()'s trim + downscale/bitrate DECISIONS. The native
// react-native-video-trim module is mocked, so we assert exactly what trim() and
// compress() are asked to do (short-edge cap, orientation, fixed bitrate) without
// running a real encoder.
//
// The size decisions come from the clip's MEASURED displayed size (a decoded
// frame, read through expo-image-manipulator), not the picker's width/height —
// which can be missing (camera clips) or the sideways raw size of a rotated
// clip. `mockShown` below is what that measurement returns.
const mockTrim = jest.fn(async () => ({ outputPath: 'file://trimmed.mp4' }));
const mockCompress = jest.fn(async () => ({ outputPath: 'file://compressed.mp4' }));
const mockGetFrameAt = jest.fn(async () => ({ outputPath: 'file://frame.jpg' }));
let mockShown = null;

jest.mock('react-native-video-trim', () => ({
  trim: (...a) => mockTrim(...a),
  compress: (...a) => mockCompress(...a),
  getFrameAt: (...a) => mockGetFrameAt(...a),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async () => {
    if (!mockShown) throw new Error('no frame');
    return { uri: 'file://probe.jpg', ...mockShown };
  }),
}));
// The compressed file is always smaller here, so the re-encode is kept.
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async (uri) => ({ size: uri.includes('compressed') ? 1000 : 5000 })),
}));

const { processVideo, isVideoProcessingAvailable } = require('../videoProcessing');

const compressOpts = () => mockCompress.mock.calls[mockCompress.mock.calls.length - 1][1];
// getFrameAt is also used to measure the clip; the POSTER call is the one at
// the poster's max width.
const posterCalls = () => mockGetFrameAt.mock.calls.filter((c) => c[1]?.maxWidth === 1080);

beforeEach(() => {
  mockTrim.mockClear();
  mockCompress.mockClear();
  mockGetFrameAt.mockClear();
  mockShown = null;
});

test('the native module is detected as available (mocked)', () => {
  expect(isVideoProcessingAvailable()).toBe(true);
});

test('trims only when an end window past the start is given', async () => {
  await processVideo({ uri: 'file://src.mp4', startSec: 2, endSec: 10, width: 1080, height: 1920 });
  expect(mockTrim).toHaveBeenCalledTimes(1);
  expect(mockTrim.mock.calls[0][1]).toEqual({ startTime: 2000, endTime: 10000 });

  mockTrim.mockClear();
  await processVideo({ uri: 'file://src.mp4', width: 1080, height: 1920 }); // no endSec
  expect(mockTrim).not.toHaveBeenCalled();
});

test('portrait wider than the cap: short edge (width) is set to 720', async () => {
  mockShown = { width: 1080, height: 1920 };
  await processVideo({ uri: 'file://p.mp4' });
  expect(compressOpts()).toEqual({ bitrate: 2_000_000, width: 720 });
});

test('landscape taller than the cap: short edge (height) is set to 720', async () => {
  mockShown = { width: 1920, height: 1080 };
  await processVideo({ uri: 'file://l.mp4' });
  expect(compressOpts()).toEqual({ bitrate: 2_000_000, height: 720 });
});

test('a rotated clip is scaled by how it is SHOWN, not the raw picker size', async () => {
  mockShown = { width: 1080, height: 1920 };                               // portrait on screen
  await processVideo({ uri: 'file://r.mp4', width: 1920, height: 1080 }); // picker: sideways
  expect(compressOpts()).toEqual({ bitrate: 2_000_000, width: 720 });
});

test('source already within the cap: no resize, bitrate still applied (no upscale)', async () => {
  mockShown = { width: 640, height: 480 };
  await processVideo({ uri: 'file://s.mp4' });
  expect(compressOpts()).toEqual({ bitrate: 2_000_000 });
});

test('unmeasurable and unknown dimensions: skip resize (avoid upscaling), bitrate only', async () => {
  await processVideo({ uri: 'file://u.mp4' });
  expect(compressOpts()).toEqual({ bitrate: 2_000_000 });
});

test('poster frame extracted only when requested', async () => {
  mockShown = { width: 1080, height: 1920 };
  await processVideo({ uri: 'file://src.mp4' });
  expect(posterCalls()).toHaveLength(0);

  const res = await processVideo({ uri: 'file://src.mp4', thumbnail: true });
  expect(posterCalls()).toHaveLength(1);
  expect(res.thumbnailUri).toBe('file://frame.jpg');
});

test('returns the compressed clip with its output size and marks it processed', async () => {
  mockShown = { width: 1080, height: 1920 };
  const res = await processVideo({ uri: 'file://src.mp4' });
  expect(res.uri).toBe('file://compressed.mp4');
  expect(res.processed).toBe(true);
  expect([res.width, res.height]).toEqual([720, 1280]);
});
