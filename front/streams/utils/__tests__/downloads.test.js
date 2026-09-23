/**
 * Offline downloads: the store the player and three screens read. File
 * system, storage and API are mocked; what's pinned is the index lifecycle
 * (download → persist → reload → remove), pruning of vanished files, and that
 * a failed download leaves no half-state behind.
 */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  makeDirectoryAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1234 })),
  deleteAsync: jest.fn(async () => {}),
  downloadAsync: jest.fn(async (url, to) => ({ uri: to, status: 200 })),
  createDownloadResumable: jest.fn((url, to, opts, cb) => ({
    downloadAsync: jest.fn(async () => {
      cb?.({ totalBytesWritten: 50, totalBytesExpectedToWrite: 100 });
      cb?.({ totalBytesWritten: 100, totalBytesExpectedToWrite: 100 });
      return { uri: to, status: 200 };
    }),
    pauseAsync: jest.fn(async () => {}),
  })),
}));
jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    getItem: jest.fn(async (k) => store[k] ?? null),
    setItem: jest.fn(async (k, v) => { store[k] = v; }),
    __reset: () => { store = {}; },
  };
});
jest.mock('../../services/api', () => ({ apiRequest: jest.fn() }));

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../../services/api';
import {
  initDownloads, downloadTrack, removeDownload, getLocalUri, isDownloaded, __resetDownloads,
} from '../downloads';

const flush = () => new Promise((r) => setTimeout(r, 0));
const track = { id: 7, title: 'Hymn', audio_file: 'https://cdn/x/hymn.m4a', cover_image: 'https://cdn/c.jpg', lyrics: 'long text' };

beforeEach(async () => {
  jest.clearAllMocks();
  AsyncStorage.__reset();
  __resetDownloads();
  apiRequest.mockResolvedValue({ download_url: 'https://cdn/x/hymn.m4a' });
  await initDownloads(1);
});

it('downloads audio + cover, counts it, and indexes a slim row', async () => {
  const entry = await downloadTrack(track);
  expect(apiRequest).toHaveBeenCalledWith('get', '/tracks/7/download/', null, { params: { quality: 'standard' } });
  expect(entry.uri).toBe('file:///docs/music/7.m4a');
  expect(entry.coverUri).toBe('file:///docs/music/7_cover.jpg');
  expect(entry.track).not.toHaveProperty('lyrics');
  expect(getLocalUri(7)).toBe('file:///docs/music/7.m4a');
});

it('persists per account and survives a reload', async () => {
  await downloadTrack(track);
  await flush();
  __resetDownloads();
  expect(isDownloaded(7)).toBe(false);
  await initDownloads(1);
  expect(isDownloaded(7)).toBe(true);
  await initDownloads(2);             // another account on this phone
  expect(isDownloaded(7)).toBe(false);
});

it('drops entries whose file has vanished', async () => {
  await downloadTrack(track);
  await flush();
  FileSystem.getInfoAsync.mockResolvedValueOnce({ exists: false });
  await initDownloads(1);
  expect(isDownloaded(7)).toBe(false);
});

it('still saves when the download counter call fails', async () => {
  apiRequest.mockRejectedValueOnce(new Error('offline'));
  const entry = await downloadTrack(track);
  expect(entry.uri).toBe('file:///docs/music/7.m4a'); // falls back to the row's URL
});

it('leaves nothing behind when the download fails', async () => {
  FileSystem.createDownloadResumable.mockReturnValueOnce({
    downloadAsync: jest.fn(async () => { throw new Error('network'); }),
  });
  await expect(downloadTrack(track)).rejects.toThrow('network');
  expect(isDownloaded(7)).toBe(false);
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///docs/music/7.m4a', { idempotent: true });
});

it('removes the file, the cover and the entry', async () => {
  await downloadTrack(track);
  await removeDownload(7);
  expect(isDownloaded(7)).toBe(false);
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///docs/music/7.m4a', { idempotent: true });
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///docs/music/7_cover.jpg', { idempotent: true });
});

it('asks for the chosen quality and keeps the processed version', async () => {
  const processed = { ...track, id: 9, audio_standard: 'https://cdn/t/9/128.m4a', cover_medium: 'https://cdn/t/9/cover_600.jpg' };
  apiRequest.mockRejectedValueOnce(new Error('offline'));   // counter down: fall back to the track's own URL
  await downloadTrack(processed, { quality: 'standard' });
  expect(apiRequest).toHaveBeenCalledWith('get', '/tracks/9/download/', null, { params: { quality: 'standard' } });
  expect(FileSystem.createDownloadResumable.mock.calls[0][0]).toBe('https://cdn/t/9/128.m4a');
  expect(FileSystem.downloadAsync.mock.calls[0][0]).toBe('https://cdn/t/9/cover_600.jpg');
});

it('Wi-Fi only refuses a download on mobile data, and allows it on Wi-Fi', async () => {
  await expect(downloadTrack(track, { wifiOnly: true, network: 'cellular' })).rejects.toMatchObject({ code: 'wifi_only' });
  expect(isDownloaded(7)).toBe(false);
  expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
  await downloadTrack(track, { wifiOnly: true, network: 'wifi' });
  expect(isDownloaded(7)).toBe(true);
});
