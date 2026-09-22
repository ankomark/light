// The work behind "Post" and "Upload track", as background-queue jobs.
//
// Each builder takes a plain snapshot of what the user chose — no React state,
// since the screen that built it is closed by the time the job runs — and
// returns the job's `run` function for enqueueUpload().
import { uploadMedia } from './cloudinary';
import { createSocialPost, apiRequest } from './api';
import { processVideo, cleanupProcessedVideos } from './videoProcessing';
import { compressAudio } from './audioProcessing';

const EXT = { video: 'mp4', audio: 'mp3', image: 'jpg' };
const MIME = { video: 'video/mp4', audio: 'audio/mpeg', image: 'image/jpeg' };
const UPLOAD_TYPE = { video: 'social-video', audio: 'audio', image: 'social-image' };

// Upload one local file and normalise the result. R2 returns no dimensions,
// so the picker's width/height are carried through — without them the feed
// can't know a post's aspect ratio and crops every image square.
export const uploadFile = async (file, type, onProgress, uploadType = UPLOAD_TYPE[type]) => {
  const result = await uploadMedia(
    {
      uri: file.uri,
      name: file.fileName ?? file.name ?? `post_${Date.now()}.${EXT[type] || 'bin'}`,
      mimeType: file.mimeType ?? file.type ?? MIME[type],
    },
    uploadType,
    onProgress,
  );
  return {
    url: result.url,
    width: result.width ?? file.width ?? null,
    height: result.height ?? file.height ?? null,
  };
};

/**
 * Progress across several files that upload at the same time, weighted by
 * size where known (a 4 MB video part shouldn't count the same as a 40 KB
 * poster). Returns one reporter per file; `span` maps the combined 0..1 onto a
 * slice of the job's bar, so an earlier processing stage can own the start.
 */
export const combinedProgress = (report, weights, [from, to] = [0, 1]) => {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const parts = weights.map(() => 0);
  return weights.map((_, i) => (fraction) => {
    parts[i] = Math.max(0, Math.min(1, fraction || 0));
    const done = parts.reduce((sum, p, k) => sum + p * weights[k], 0) / total;
    report(from + (to - from) * done);
  });
};

const localAudioFile = async (localAudio) => {
  // ~128 kbps AAC before upload to cut storage cost; keeps the original when it
  // was already low-bitrate. Relabel as m4a when compressed so the stored file's
  // type matches its bytes.
  const { uri, compressed } = await compressAudio({ uri: localAudio.uri });
  if (!compressed) return localAudio;
  const name = `audio_${Date.now()}.m4a`;
  return { ...localAudio, uri, name, fileName: name, mimeType: 'audio/mp4', type: 'audio/mp4' };
};

/**
 * Snapshot shape:
 *   { contentType: 'image'|'video', caption, visibility, commentsEnabled,
 *     clientId,                                     // set by the queue
 *     images: [{uri,width,height}],                 // image posts
 *     video: {uri,width,height,duration}, trim: {start,end},   // video posts
 *     coverSec,                                     // chosen cover, source-video seconds
 *     song: { title, artist, audioUrl, songId?, start, end, localAudio? } }
 */
export const buildPostJob = (snap) => async ({ progress, stage, thumbnail }) => {
  let postData;

  if (snap.contentType === 'image') {
    const song = snap.song;
    const audioFile = song?.localAudio ? await localAudioFile(song.localAudio) : null;

    stage('uploading');
    // All files at once: the old loop uploaded images one after another, so a
    // 4-image post took four round trips back to back.
    const weights = [...snap.images.map(() => 1), ...(audioFile ? [2] : [])];
    const reporters = combinedProgress(progress, weights, [0, 0.95]);
    const [uploads, audioUpload] = await Promise.all([
      Promise.all(snap.images.map((img, i) => uploadFile(img, 'image', reporters[i]))),
      audioFile ? uploadFile(audioFile, 'audio', reporters[snap.images.length]) : null,
    ]);

    const songData = {};
    const audioUrl = audioUpload?.url || song?.audioUrl;
    if (song && audioUrl) {
      Object.assign(songData, {
        song_audio_url: audioUrl,
        song_title: song.title || '',
        song_artist: song.artist || '',
        song_start_time: Number((song.start || 0).toFixed(2)),
        song_end_time: Number((song.end || 0).toFixed(2)),
        ...(song.songId != null ? { song_id: song.songId } : {}),
      });
    }

    const gallery = uploads.map((u) => ({ public_id: u.url, width: u.width, height: u.height }));
    postData = {
      caption: snap.caption.trim(),
      content_type: 'image',
      media_file: gallery[0].public_id,
      width: gallery[0].width,
      height: gallery[0].height,
      gallery,
      ...songData,
    };
  } else {
    // R2 stores bytes verbatim, so the clip is cut + compressed on-device first.
    // This used to happen while the user watched a modal; now it's the first
    // stretch of the pill's bar.
    stage('processing');
    progress(0.02);
    const { video, trim } = snap;
    const processed = await processVideo({
      uri: video.uri,
      startSec: trim.start,
      endSec: trim.end,
      width: video.width,
      height: video.height,
      thumbnail: true,
      // The picker gives source-video time; the poster comes from the trimmed
      // clip, which starts at trim.start.
      thumbnailAtSec: Math.max(0, (snap.coverSec ?? trim.start) - trim.start),
    });
    if (!processed.processed) {
      console.warn('[postUploads] video processing unavailable — uploading raw clip.');
    }
    if (processed.thumbnailUri) thumbnail(processed.thumbnailUri);

    stage('uploading');
    // The poster uploads alongside the clip instead of after it.
    const [videoReport, posterReport] = combinedProgress(
      progress, [20, processed.thumbnailUri ? 1 : 0], [0.15, 0.95],
    );
    const [upload, posterUrl] = await Promise.all([
      // The processed file's own displayed size — measured from a frame, so a
      // rotated phone clip or a camera clip (no picker size) gets the right
      // shape in the feed.
      uploadFile({
        ...video,
        uri: processed.uri,
        width: processed.width ?? video.width,
        height: processed.height ?? video.height,
      }, 'video', videoReport),
      processed.thumbnailUri
        ? uploadFile(
          { uri: processed.thumbnailUri, name: `poster_${Date.now()}.jpg`, mimeType: 'image/jpeg' },
          'image', posterReport,
        ).then((r) => r.url).catch((e) => {
          // A missing poster costs the grid a still, not the post.
          console.warn('[postUploads] poster upload failed', e?.message);
          return null;
        })
        : null,
    ]);

    postData = {
      caption: snap.caption.trim(),
      content_type: 'video',
      media_file: upload.url,
      ...(posterUrl ? { thumbnail: posterUrl } : {}),
      width: upload.width ?? video.width,
      height: upload.height ?? video.height,
      // The stored file is already the trimmed clip, starting at 0.
      duration: Math.max(1, Math.round(trim.end - trim.start)),
    };
  }

  stage('finishing');
  const created = await createSocialPost({
    ...postData,
    visibility: snap.visibility || 'public',
    comments_enabled: snap.commentsEnabled !== false,
    ...(snap.clientId ? { client_id: snap.clientId } : {}),
  });
  progress(1);
  cleanupProcessedVideos();
  return created;
};

/**
 * Snapshot: { title, album, lyrics, audio: {uri,name,mimeType}, cover?: {uri,...} }
 */
export const buildTrackJob = (snap) => async ({ progress, stage }) => {
  stage('processing');
  progress(0.02);
  const { uri, compressed } = await compressAudio({ uri: snap.audio.uri });
  const audio = compressed
    ? { ...snap.audio, uri, name: `track_${Date.now()}.m4a`, mimeType: 'audio/mp4', type: 'audio/mp4' }
    : snap.audio;

  stage('uploading');
  // Audio and cover together; the cover is small, so it barely moves the bar.
  const [audioReport, coverReport] = combinedProgress(progress, [20, snap.cover ? 1 : 0], [0.1, 0.95]);
  const [audioUpload, coverUpload] = await Promise.all([
    uploadMedia(audio, 'audio', audioReport),
    snap.cover ? uploadMedia(snap.cover, 'cover', coverReport) : null,
  ]);

  stage('finishing');
  // Through apiRequest, not a bare axios call with a token read up front: a
  // long upload can outlive the access token, and apiRequest refreshes it.
  const track = await apiRequest('post', '/tracks/upload/', {
    title: snap.title,
    audio_file: audioUpload.publicId,
    cover_image: coverUpload?.publicId || null,
    album: snap.album || null,
    lyrics: snap.lyrics || null,
    ...(snap.clientId ? { client_id: snap.clientId } : {}),
  });
  progress(1);
  return track;
};
