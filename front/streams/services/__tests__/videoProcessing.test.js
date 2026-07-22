// Verifies processVideo()'s trim + downscale/bitrate DECISIONS. The native
// react-native-video-trim module is mocked, so we assert exactly what trim() and
// compress() are asked to do (short-edge cap, orientation, fixed bitrate) without
// running a real encoder.
const mockTrim = jest.fn(async () => ({ outputPath: 'file://trimmed.mp4' }));
const mockCompress = jest.fn(async () => ({ outputPath: 'file://compressed.mp4' }));
const mockGetFrameAt = jest.fn(async () => ({ outputPath: 'file://frame.jpg' }));

jest.mock('react-native-video-trim', () => ({
  trim: (...a) => mockTrim(...a),
  compress: (...a) => mockCompress(...a),
  getFrameAt: (...a) => mockGetFrameAt(...a),
}));

const { processVideo, isVideoProcessingAvailable } = require('../videoProcessing');

const compressOpts = () => mockCompress.mock.calls[mockCompress.mock.calls.length - 1][1];

beforeEach(() => {
  mockTrim.mockClear();
  mockCompress.mockClear();
  mockGetFrameAt.mockClear();
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
  await processVideo({ uri: 'file://p.mp4', width: 1080, height: 1920 });
  expect(compressOpts()).toEqual({ bitrate: 2_000_000, width: 720 });
});

test('landscape taller than the cap: short edge (height) is set to 720', async () => {
  await processVideo({ uri: 'file://l.mp4', width: 1920, height: 1080 });
  expect(compressOpts()).toEqual({ bitrate: 2_000_000, height: 720 });
});

test('source already within the cap: no resize, bitrate still applied (no upscale)', async () => {
  await processVideo({ uri: 'file://s.mp4', width: 640, height: 480 });
  expect(compressOpts()).toEqual({ bitrate: 2_000_000 });
});

test('unknown dimensions: skip resize (avoid upscaling), bitrate only', async () => {
  await processVideo({ uri: 'file://u.mp4' });
  expect(compressOpts()).toEqual({ bitrate: 2_000_000 });
});

test('poster frame extracted only when requested', async () => {
  await processVideo({ uri: 'file://src.mp4', width: 1080, height: 1920 });
  expect(mockGetFrameAt).not.toHaveBeenCalled();

  const res = await processVideo({ uri: 'file://src.mp4', width: 1080, height: 1920, thumbnail: true });
  expect(mockGetFrameAt).toHaveBeenCalledTimes(1);
  expect(res.thumbnailUri).toBe('file://frame.jpg');
});

test('returns the compressed clip and marks it processed', async () => {
  const res = await processVideo({ uri: 'file://src.mp4', width: 1080, height: 1920 });
  expect(res.uri).toBe('file://compressed.mp4');
  expect(res.processed).toBe(true);
});
