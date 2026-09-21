/**
 * Durable media copies for resumable uploads and drafts. The file system is
 * mocked; what's pinned is which uris get copied (local files only, each
 * once), where they land, and that the rest of the snapshot is untouched.
 */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  moveAsync: jest.fn(async () => {}),
}));

import * as FileSystem from 'expo-file-system/legacy';
import { copySnapMedia, uploadsDir, draftsDir, rebaseSnap } from '../mediaStore';

// Pin the per-call stamp so file names are predictable ('rs' = 1000 base36).
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(1000);
});
afterEach(() => jest.restoreAllMocks());

it('copies local media into the job folder and rewrites the uris', async () => {
  const dir = uploadsDir('up_1');
  const out = await copySnapMedia(dir, {
    contentType: 'image',
    caption: 'hi',
    images: [{ uri: 'file:///cache/a.jpg', width: 10 }, { uri: 'content://media/42', width: 20 }],
    song: { title: 'Library song', audioUrl: 'https://r2/s.mp3', localAudio: null },
  });
  expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith(dir, { intermediates: true });
  expect(FileSystem.copyAsync).toHaveBeenCalledTimes(2);
  expect(out.images).toEqual([
    { uri: `${dir}mrs_0.jpg`, width: 10 },
    { uri: `${dir}mrs_1.jpg`, width: 20 },   // content:// has no extension → default
  ]);
  expect(out.caption).toBe('hi');
  expect(out.song.audioUrl).toBe('https://r2/s.mp3'); // remote: not copied
});

it('copies video, local audio, track audio and cover', async () => {
  const dir = draftsDir('d1');
  const out = await copySnapMedia(dir, {
    video: { uri: 'file:///cache/v.mov', width: 720 },
    song: { localAudio: { uri: 'file:///cache/s.m4a', name: 's.m4a' } },
    audio: { uri: 'file:///cache/t.wav' },
    cover: { uri: 'file:///cache/c.png' },
  });
  expect(out.video.uri).toBe(`${dir}mrs_0.mov`);
  expect(out.song.localAudio).toEqual({ uri: `${dir}mrs_1.m4a`, name: 's.m4a' });
  expect(out.audio.uri).toBe(`${dir}mrs_2.wav`);
  expect(out.cover.uri).toBe(`${dir}mrs_3.png`);
});

it('leaves files already in the folder alone', async () => {
  const dir = uploadsDir('up_2');
  await copySnapMedia(dir, { images: [{ uri: `${dir}mrs_0.jpg` }] });
  expect(FileSystem.copyAsync).not.toHaveBeenCalled();
});

it('rebases every uri from one folder to another', () => {
  const from = draftsDir('d1');
  const to = uploadsDir('up_9');
  const snap = { images: [{ uri: `${from}m0.jpg` }], video: { uri: `${from}m1.mp4` }, caption: 'x' };
  expect(rebaseSnap(snap, from, to)).toEqual({
    images: [{ uri: `${to}m0.jpg` }], video: { uri: `${to}m1.mp4` }, caption: 'x',
  });
});
