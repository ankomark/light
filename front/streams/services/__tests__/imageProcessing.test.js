// Verifies the resize/compress DECISIONS compressImage() makes — the part we
// own — without touching real pixels. expo-image-manipulator (the native encoder)
// is mocked so we can assert exactly what actions/options it's handed.
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async () => ({ uri: 'file://out.jpg', width: 1080, height: 1350 })),
}));

const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');
const { compressImage } = require('../imageProcessing');

// The (uri, actions, options) of the most recent manipulateAsync call.
const lastCall = () => manipulateAsync.mock.calls[manipulateAsync.mock.calls.length - 1];

beforeEach(() => manipulateAsync.mockClear());

describe('compressImage — cap mode (feed/avatar uploads)', () => {
  test('downscales to maxWidth when the source is wider', async () => {
    await compressImage('file://big.jpg', { maxWidth: 1080, sourceWidth: 4000 });
    const [uri, actions, opts] = lastCall();
    expect(uri).toBe('file://big.jpg');
    expect(actions).toEqual([{ resize: { width: 1080 } }]);
    expect(opts.compress).toBe(0.8);        // default quality
    expect(opts.format).toBe(SaveFormat.JPEG);
  });

  test('never UPSCALES a source already within the cap (no resize action)', async () => {
    await compressImage('file://small.jpg', { maxWidth: 1080, sourceWidth: 800 });
    const [, actions] = lastCall();
    expect(actions).toEqual([]); // re-encode/compress only, no resize
  });

  test('resizes to the cap when the source width is unknown (safe default)', async () => {
    await compressImage('file://unknown.jpg', { maxWidth: 1080 });
    const [, actions] = lastCall();
    expect(actions).toEqual([{ resize: { width: 1080 } }]);
  });
});

describe('compressImage — explicit-size mode', () => {
  test('resizes to an explicit width', async () => {
    await compressImage('file://a.jpg', { width: 256 });
    const [, actions] = lastCall();
    expect(actions).toEqual([{ resize: { width: 256 } }]);
  });

  test('resizes to an explicit width + height', async () => {
    await compressImage('file://a.jpg', { width: 256, height: 256 });
    const [, actions] = lastCall();
    expect(actions).toEqual([{ resize: { width: 256, height: 256 } }]);
  });
});

describe('compressImage — options passthrough', () => {
  test('honors a custom quality', async () => {
    await compressImage('file://a.jpg', { maxWidth: 1080, sourceWidth: 4000, quality: 0.5 });
    expect(lastCall()[2].compress).toBe(0.5);
  });

  test('always encodes JPEG', async () => {
    await compressImage('file://a.jpg', {});
    expect(lastCall()[2].format).toBe(SaveFormat.JPEG);
  });

  test('requests base64 only when asked', async () => {
    await compressImage('file://a.jpg', { maxWidth: 1080, sourceWidth: 4000 });
    expect(lastCall()[2].base64).toBeUndefined();
    await compressImage('file://a.jpg', { maxWidth: 1080, sourceWidth: 4000, base64: true });
    expect(lastCall()[2].base64).toBe(true);
  });
});
