// Durable copies of picked media, for uploads that must survive the app being
// killed and for drafts.
//
// The picker, the camera, the cropper and the video processor all hand back
// files in the cache directory, which the OS is allowed to purge whenever the
// app isn't running. Anything that has to outlive this process — a queued
// upload, a saved draft — gets its files copied under documentDirectory
// first, into a folder of its own so it can be removed in one go.
import * as FileSystem from 'expo-file-system/legacy';

const ROOT = FileSystem.documentDirectory;
export const uploadsDir = (id) => `${ROOT}uploads/${id}/`;
export const draftsDir = (id) => `${ROOT}drafts/${id}/`;

const isLocal = (uri) => typeof uri === 'string' && /^(file|content):\/\//.test(uri);

const extOf = (uri, fallback) => {
  const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(uri || '');
  return m ? m[1].toLowerCase() : fallback;
};

const ensureDir = async (dir) => {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
};

/**
 * Copy every local file a snapshot references into `dir`, returning the
 * snapshot with its uris rewritten. Remote URLs (a library song) and files
 * already inside `dir` are left alone.
 */
export const copySnapMedia = async (dir, snap) => {
  await ensureDir(dir);
  // Names are unique per call, not m0, m1…: re-saving a draft copies new
  // files into a folder that still holds files the draft references, and a
  // restarted counter would overwrite one of them.
  const stamp = Date.now().toString(36);
  let n = 0;
  const copy = async (uri, fallbackExt) => {
    if (!isLocal(uri) || uri.startsWith(dir)) return uri;
    const to = `${dir}m${stamp}_${n++}.${extOf(uri, fallbackExt)}`;
    await FileSystem.copyAsync({ from: uri, to });
    return to;
  };

  const out = { ...snap };
  if (Array.isArray(snap.images)) {
    out.images = await Promise.all(snap.images.map(async (img) => ({ ...img, uri: await copy(img.uri, 'jpg') })));
  }
  if (snap.video?.uri) out.video = { ...snap.video, uri: await copy(snap.video.uri, 'mp4') };
  if (snap.song?.localAudio?.uri) {
    out.song = { ...snap.song, localAudio: { ...snap.song.localAudio, uri: await copy(snap.song.localAudio.uri, 'mp3') } };
  }
  if (snap.audio?.uri) out.audio = { ...snap.audio, uri: await copy(snap.audio.uri, 'mp3') };
  if (snap.cover?.uri) out.cover = { ...snap.cover, uri: await copy(snap.cover.uri, 'jpg') };
  if (snap.thumbUri) out.thumbUri = await copy(snap.thumbUri, 'jpg');
  return out;
};

export const removeDir = (dir) =>
  FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {});

/** Move a folder (a draft's media → an upload's) without copying bytes. */
export const moveDir = async (from, to) => {
  await ensureDir(to.replace(/[^/]+\/$/, ''));
  await FileSystem.moveAsync({ from, to });
};

/** Rewrite uris under `from` to point under `to` (after moveDir). */
export const rebaseSnap = (snap, from, to) =>
  JSON.parse(JSON.stringify(snap).split(from).join(to));
