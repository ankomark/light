/**
 * Saving a song to the phone must never trigger Android's per-file "allow
 * this app to modify this file?" consent. That prompt comes from MOVING an
 * existing library item; creating a new one needs no consent. These tests pin
 * that every path creates, and none moves.
 */
jest.mock('expo-media-library', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  createAssetAsync: jest.fn(),
  createAlbumAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    getItem: jest.fn(async (k) => store[k] ?? null),
    setItem: jest.fn(async (k, v) => { store[k] = v; }),
    removeItem: jest.fn(async (k) => { delete store[k]; }),
    __reset: () => { store = {}; },
  };
});

import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveToPhone, ALBUM_NAME } from '../saveToPhone';

const FILE = 'file:///docs/downloads/7/Amazing Grace.m4a';

beforeEach(() => {
  jest.clearAllMocks();
  AsyncStorage.__reset();
  Platform.OS = 'android';
  MediaLibrary.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  MediaLibrary.createAlbumAsync.mockResolvedValue({ id: 'album-1' });
  MediaLibrary.createAssetAsync.mockResolvedValue({ id: 'asset-1' });
});

const neverMoved = () => {
  // createAlbumAsync(name, asset, copyAsset=false) is the move that prompted.
  for (const call of MediaLibrary.createAlbumAsync.mock.calls) {
    expect(call[1]).toBeUndefined();   // no existing asset handed over
  }
};

it('first save creates the album from the file itself', async () => {
  expect(await saveToPhone(FILE)).toBe('library');
  expect(MediaLibrary.createAlbumAsync).toHaveBeenCalledWith(ALBUM_NAME, undefined, undefined, FILE);
  expect(MediaLibrary.createAssetAsync).not.toHaveBeenCalled();
  neverMoved();
});

it('later saves go straight into the remembered album', async () => {
  await saveToPhone(FILE);
  jest.clearAllMocks();
  await saveToPhone('file:///docs/downloads/8/Other.m4a');
  expect(MediaLibrary.createAssetAsync).toHaveBeenCalledWith('file:///docs/downloads/8/Other.m4a', 'album-1');
  expect(MediaLibrary.createAlbumAsync).not.toHaveBeenCalled();
});

it('recreates the album if the user deleted it', async () => {
  await saveToPhone(FILE);
  MediaLibrary.createAssetAsync.mockRejectedValueOnce(new Error('album gone'));
  MediaLibrary.createAlbumAsync.mockResolvedValueOnce({ id: 'album-2' });
  expect(await saveToPhone(FILE)).toBe('library');
  expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('@savetophone:albumId', 'album-2');
  neverMoved();
});

it('still saves to Music when no album can be made', async () => {
  MediaLibrary.createAlbumAsync.mockRejectedValueOnce(new Error('no albums'));
  expect(await saveToPhone(FILE)).toBe('library');
  expect(MediaLibrary.createAssetAsync).toHaveBeenCalledWith(FILE);
});

it('asks for write-only audio access, once, and only when needed', async () => {
  await saveToPhone(FILE);
  expect(MediaLibrary.getPermissionsAsync).toHaveBeenCalledWith(true, ['audio']);
  expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();  // already granted
  MediaLibrary.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true });
  MediaLibrary.requestPermissionsAsync.mockResolvedValueOnce({ granted: true });
  await saveToPhone(FILE);
  expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true, ['audio']);
});

it('explains a permanently refused permission', async () => {
  MediaLibrary.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false });
  await expect(saveToPhone(FILE)).rejects.toThrow(/Settings/);
});

it('uses the share sheet on iOS', async () => {
  Platform.OS = 'ios';
  expect(await saveToPhone(FILE)).toBe('shared');
  expect(Sharing.shareAsync).toHaveBeenCalledWith(FILE);
  expect(MediaLibrary.createAssetAsync).not.toHaveBeenCalled();
});
