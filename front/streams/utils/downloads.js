// Offline music: tracks saved inside the app for listening without a
// connection, Spotify-style.
//
// Files live under documentDirectory/music/ (never purged by the OS), with
// the cover art beside them so the offline list and the lock screen still have
// a picture. The index — which tracks, and their row data — is per account in
// AsyncStorage, so a shared phone never mixes two people's downloads.
//
// This is a small store rather than React state: the track row, Now Playing,
// the Downloads screen and the player all read it, and a download in progress
// must keep going after the screen that started it closes.
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { apiRequest } from '../services/api';

const DIR = `${FileSystem.documentDirectory}music/`;
const indexKey = (userId) => `@downloads:v1:u${userId ?? 'anon'}`;

let userId = null;
let index = {};              // trackId -> { track, uri, coverUri, savedAt, bytes }
let progress = {};           // trackId -> 0..1 while downloading
let snapshot = { index, progress };
const tasks = {};            // trackId -> DownloadResumable
const subs = new Set();

const publish = () => {
  snapshot = { index, progress };
  subs.forEach((fn) => fn());
};
const persist = () => AsyncStorage.setItem(indexKey(userId), JSON.stringify(index)).catch(() => {});

const extOf = (url, fallback) => {
  const m = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(url || '');
  return m ? m[1].toLowerCase() : fallback;
};

// What a row needs to render and play, without the heavy fields.
const slim = (track) => {
  const { lyrics, ...rest } = track || {};
  return rest;
};

/** Load the signed-in account's downloads (dropping any whose file is gone). */
export const initDownloads = async (uid) => {
  userId = uid;
  let stored = {};
  try { stored = JSON.parse((await AsyncStorage.getItem(indexKey(uid))) || '{}') || {}; } catch { stored = {}; }
  const checked = {};
  await Promise.all(Object.entries(stored).map(async ([id, entry]) => {
    try {
      const info = await FileSystem.getInfoAsync(entry.uri);
      if (info.exists) checked[id] = entry;
    } catch { /* unreadable — treat as gone */ }
  }));
  index = checked;
  progress = {};
  publish();
  if (Object.keys(checked).length !== Object.keys(stored).length) persist();
};

export const getLocalUri = (trackId) => index[trackId]?.uri || null;
export const getLocalCover = (trackId) => index[trackId]?.coverUri || null;
export const isDownloaded = (trackId) => !!index[trackId];

/** Save a track for offline listening. Resolves with the index entry. */
export const downloadTrack = async (track) => {
  const id = track?.id;
  if (id == null || index[id] || progress[id] != null) return index[id] || null;
  progress = { ...progress, [id]: 0 };
  publish();
  let uri = null;
  try {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    // Counts the download server-side, and hands back the canonical URL.
    let url = track.audio_file;
    try {
      const res = await apiRequest('get', `/tracks/${id}/download/`);
      if (res?.download_url) url = res.download_url;
    } catch { /* offline counter failure mustn't block the save */ }
    if (!url) throw new Error('This track has no audio file.');

    uri = `${DIR}${id}.${extOf(url, 'mp3')}`;
    const task = FileSystem.createDownloadResumable(url, uri, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (totalBytesExpectedToWrite > 0) {
        const p = totalBytesWritten / totalBytesExpectedToWrite;
        // Whole percents only: a row re-rendering per network chunk is waste.
        if (Math.floor(p * 100) !== Math.floor((progress[id] ?? 0) * 100)) {
          progress = { ...progress, [id]: p };
          publish();
        }
      }
    });
    tasks[id] = task;
    const result = await task.downloadAsync();
    delete tasks[id];
    if (!result || (result.status && result.status >= 400)) throw new Error('Download failed.');

    let coverUri = null;
    if (track.cover_image) {
      try {
        const c = await FileSystem.downloadAsync(track.cover_image, `${DIR}${id}_cover.${extOf(track.cover_image, 'jpg')}`);
        coverUri = c?.uri || null;
      } catch { /* no offline art is fine */ }
    }
    const info = await FileSystem.getInfoAsync(uri).catch(() => ({}));
    const entry = { track: slim(track), uri, coverUri, savedAt: Date.now(), bytes: info.size || 0 };
    index = { ...index, [id]: entry };
    const { [id]: _done, ...rest } = progress;
    progress = rest;
    publish();
    persist();
    return entry;
  } catch (e) {
    delete tasks[id];
    const { [id]: _failed, ...rest } = progress;
    progress = rest;
    publish();
    // Drop the half-written file so a retry starts clean.
    if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    throw e;
  }
};

/** Stop a download in progress. */
export const cancelDownload = async (trackId) => {
  const task = tasks[trackId];
  delete tasks[trackId];
  if (task) await task.pauseAsync().catch(() => {});
  const { [trackId]: _c, ...rest } = progress;
  progress = rest;
  publish();
};

/** Delete a downloaded track (file, cover and index entry). */
export const removeDownload = async (trackId) => {
  const entry = index[trackId];
  if (!entry) return;
  const { [trackId]: _r, ...rest } = index;
  index = rest;
  publish();
  persist();
  FileSystem.deleteAsync(entry.uri, { idempotent: true }).catch(() => {});
  if (entry.coverUri) FileSystem.deleteAsync(entry.coverUri, { idempotent: true }).catch(() => {});
};

export const subscribeDownloads = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getSnapshot = () => snapshot;

/** { status: 'none'|'downloading'|'done', progress } for one track. */
export const useDownloadState = (trackId) => {
  const snap = useSyncExternalStore(subscribeDownloads, getSnapshot, getSnapshot);
  if (snap.index[trackId]) return { status: 'done', progress: 1 };
  if (snap.progress[trackId] != null) return { status: 'downloading', progress: snap.progress[trackId] };
  return { status: 'none', progress: 0 };
};

/** Every downloaded track, newest first, as playable rows (local art). */
export const useDownloadedTracks = () => {
  const snap = useSyncExternalStore(subscribeDownloads, getSnapshot, getSnapshot);
  return Object.values(snap.index)
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((e) => ({ ...e.track, cover_image: e.coverUri || e.track.cover_image, _offline: true }));
};

// Test-only reset.
export const __resetDownloads = () => { index = {}; progress = {}; userId = null; publish(); };
