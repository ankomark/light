/**
 * Upload compression rules: never upscale, never make a file bigger, measure
 * a clip's real displayed size, and fall back to the trimmed clip rather than
 * failing an upload. Native modules are mocked; the decisions are real.
 */
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: jest.fn() }));
jest.mock('react-native-video-trim', () => ({
  trim: jest.fn(),
  compress: jest.fn(),
  getFrameAt: jest.fn(),
  cleanFiles: jest.fn(),
}));

import { Image } from 'react-native';
import { manipulateAsync } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as VideoTrim from 'react-native-video-trim';
import { planImageResize, compressImage } from '../imageProcessing';
import { planVideoScale, toFileUri, processVideo } from '../videoProcessing';

const sizes = (map) => FileSystem.getInfoAsync.mockImplementation(async (uri) => ({ size: map[uri] ?? 0 }));

beforeEach(() => jest.clearAllMocks());

describe('planImageResize', () => {
  it('treats a width as a ceiling, never upscaling', () => {
    expect(planImageResize({ width: 1080, sourceWidth: 600 })).toBeNull();
    expect(planImageResize({ width: 1080, sourceWidth: 4000 })).toEqual({ width: 1080 });
    expect(planImageResize({ maxWidth: 1080, sourceWidth: 1080 })).toBeNull();
  });
  it('resizes when the source width is unknown', () => {
    expect(planImageResize({ width: 800 })).toEqual({ width: 800 });
  });
  it('keeps an explicit box exact (square logos)', () => {
    expect(planImageResize({ width: 256, height: 256, sourceWidth: 100 })).toEqual({ width: 256, height: 256 });
  });
});

describe('compressImage', () => {
  it('reads the source size so a small photo is not blown up', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((uri, ok) => ok(600, 800));
    manipulateAsync.mockResolvedValue({ uri: 'file:///out.jpg', width: 600, height: 800 });
    sizes({ 'file:///in.png': 500, 'file:///out.jpg': 400 });
    await compressImage('file:///in.png', { width: 1080, quality: 0.6 });
    expect(manipulateAsync).toHaveBeenCalledWith('file:///in.png', [], expect.any(Object));
  });

  it('keeps an already-small JPEG when the re-encode is bigger', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((uri, ok) => ok(500, 500));
    manipulateAsync.mockResolvedValue({ uri: 'file:///out.jpg', width: 500, height: 500 });
    sizes({ 'file:///small.jpg': 40000, 'file:///out.jpg': 52000 });
    const out = await compressImage('file:///small.jpg', { width: 1080 });
    expect(out).toEqual({ uri: 'file:///small.jpg', width: 500, height: 500 });
  });

  it('always converts non-JPEG sources (HEIC/PNG must become JPEG)', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((uri, ok) => ok(500, 500));
    manipulateAsync.mockResolvedValue({ uri: 'file:///out.jpg', width: 500, height: 500 });
    sizes({ 'file:///photo.heic': 100, 'file:///out.jpg': 900 });
    const out = await compressImage('file:///photo.heic', { width: 1080 });
    expect(out.uri).toBe('file:///out.jpg');
  });

  it('downsizes a big photo', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((uri, ok) => ok(4000, 3000));
    manipulateAsync.mockResolvedValue({ uri: 'file:///out.jpg', width: 1080, height: 810 });
    const out = await compressImage('file:///big.jpg', { width: 1080 });
    expect(manipulateAsync).toHaveBeenCalledWith('file:///big.jpg', [{ resize: { width: 1080 } }], expect.any(Object));
    expect(out.width).toBe(1080);
  });
});

describe('planVideoScale', () => {
  it('caps the short edge at 720 for portrait and landscape', () => {
    expect(planVideoScale(1080, 1920)).toMatchObject({ opts: { width: 720 }, outWidth: 720, outHeight: 1280 });
    expect(planVideoScale(1920, 1080)).toMatchObject({ opts: { height: 720 }, outWidth: 1280, outHeight: 720 });
  });
  it('never upscales a small clip', () => {
    expect(planVideoScale(480, 854)).toEqual({ opts: { bitrate: 2000000 }, outWidth: 480, outHeight: 854 });
  });
  it('still caps the bitrate when the size is unknown', () => {
    expect(planVideoScale(undefined, undefined).opts).toEqual({ bitrate: 2000000 });
  });
});

it('toFileUri adds file:// to bare paths only', () => {
  expect(toFileUri('/data/x.mp4')).toBe('file:///data/x.mp4');
  expect(toFileUri('file:///data/x.mp4')).toBe('file:///data/x.mp4');
  expect(toFileUri('content://media/1')).toBe('content://media/1');
});

describe('processVideo', () => {
  beforeEach(() => {
    VideoTrim.trim.mockResolvedValue({ outputPath: '/cache/trim.mp4' });
    VideoTrim.getFrameAt.mockResolvedValue({ outputPath: '/cache/frame.jpg' });
    VideoTrim.compress.mockResolvedValue({ outputPath: '/cache/small.mp4' });
  });

  it('scales from the MEASURED size, not the sideways picker size', async () => {
    // Picker says landscape 1920x1080 (raw, rotation ignored); the frame is portrait.
    manipulateAsync.mockResolvedValue({ width: 1080, height: 1920 });
    sizes({ 'file:///cache/trim.mp4': 10_000_000, 'file:///cache/small.mp4': 4_000_000 });
    const out = await processVideo({ uri: 'file:///raw.mp4', startSec: 0, endSec: 10, width: 1920, height: 1080 });
    expect(VideoTrim.compress).toHaveBeenCalledWith('file:///cache/trim.mp4', { bitrate: 2000000, width: 720 });
    expect(out).toMatchObject({ uri: 'file:///cache/small.mp4', width: 720, height: 1280, compressed: true });
  });

  it('keeps the trimmed clip when compressing would make it bigger', async () => {
    manipulateAsync.mockResolvedValue({ width: 480, height: 854 });
    sizes({ 'file:///cache/trim.mp4': 2_000_000, 'file:///cache/small.mp4': 3_500_000 });
    const out = await processVideo({ uri: 'file:///raw.mp4', startSec: 0, endSec: 10 });
    expect(out).toMatchObject({ uri: 'file:///cache/trim.mp4', compressed: false, width: 480, height: 854 });
  });

  it('uploads the trimmed clip if the compressor fails', async () => {
    manipulateAsync.mockResolvedValue({ width: 720, height: 1280 });
    VideoTrim.compress.mockRejectedValue(new Error('unsupported codec'));
    const out = await processVideo({ uri: 'file:///raw.mp4', startSec: 2, endSec: 12, thumbnail: true });
    expect(out.uri).toBe('file:///cache/trim.mp4');
    expect(out.thumbnailUri).toBe('file:///cache/frame.jpg');
  });

  it('fails when the trim itself fails (never posts an untrimmed clip)', async () => {
    VideoTrim.trim.mockRejectedValue(new Error('bad file'));
    await expect(processVideo({ uri: 'file:///raw.mp4', startSec: 0, endSec: 10 })).rejects.toThrow('bad file');
  });
});
