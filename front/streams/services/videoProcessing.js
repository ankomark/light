// On-device video processing for uploads (Cloudflare R2 stores bytes verbatim,
// so trim + compression that Cloudinary used to do at ingest now happens here,
// BEFORE upload). Backed by react-native-video-trim (native AVFoundation /
// MediaCodec); requires a dev/native build — not available in Expo Go.
//
// processVideo() is the single entry point: it cuts the clip to the chosen
// window, downscales/compresses it, and (optionally) grabs a poster frame.
//
// It is built to never make things worse:
//   - the real, as-displayed size is measured from a frame, because the
//     picker's width/height can be missing (in-app camera) or the sideways
//     raw size of a rotated phone clip — either of which used to skip the
//     720p cap or scale the wrong edge (a soft 405×720 portrait);
//   - if the compressed file isn't smaller than the trimmed one, or the
//     compressor fails on an unusual file, the trimmed clip is uploaded as is.
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

let VideoTrim = null;
try {
  // Lazy require so a build without the native module (e.g. Expo Go) doesn't
  // crash at import time — processVideo() degrades to a no-op instead.
  VideoTrim = require('react-native-video-trim');
} catch (e) {
  console.warn('[videoProcessing] native module unavailable — upload will use the raw clip.', e?.message);
}

export const isVideoProcessingAvailable = () => !!(VideoTrim && VideoTrim.trim);

// SHORT-edge cap for stored video: 720 → 720x1280 portrait / 1280x720 landscape,
// i.e. true 720p HD. We cap the short (not long) edge so vertical feed clips stay
// crisp at 720x1280 instead of the soft ~405x720 a long-edge cap would produce.
const MAX_SHORT_EDGE = 720;

// Poster frames are still images and upscale worse than video, so keep them a
// touch sharper than the clip itself.
const THUMB_MAX_EDGE = 1080;

// Explicit H.264 target bitrate — this, not the resolution, is what actually
// shrinks the file. ~2 Mbps keeps 720p looking crisp (TikTok runs ~2–4 Mbps)
// while landing a 60s clip near ~15 MB instead of 100 MB+. Size ≈ bitrate × secs;
// drop this toward ~1_500_000 for smaller files, raise it for higher-motion clips.
const TARGET_BITRATE_BPS = 2_000_000;

// Keep the re-encode only when it's meaningfully smaller than its input.
const KEEP_IF_UNDER = 0.95;

const toMs = (sec) => Math.max(0, Math.round((Number(sec) || 0) * 1000));

/** The library returns bare absolute paths; the upload + staging code wants
 *  file:// URIs. */
export const toFileUri = (p) => (!p || /^[a-z]+:\/\//i.test(p) ? p : `file://${p}`);

/**
 * Compression options for a clip whose DISPLAYED size is width×height: the
 * short edge capped at 720 (never upscaled), plus the bitrate. Pure — tested.
 * Returns { opts, outWidth, outHeight }.
 */
export const planVideoScale = (width, height) => {
  const opts = { bitrate: TARGET_BITRATE_BPS };
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return { opts, outWidth: w || undefined, outHeight: h || undefined };
  const short = Math.min(w, h);
  if (short <= MAX_SHORT_EDGE) return { opts, outWidth: w, outHeight: h };
  const scale = MAX_SHORT_EDGE / short;
  // The encoder keeps dimensions even (scale=w:-2), so round the same way.
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  if (h >= w) {
    opts.width = MAX_SHORT_EDGE;           // portrait: width is the short edge
    return { opts, outWidth: MAX_SHORT_EDGE, outHeight: even(h * scale) };
  }
  opts.height = MAX_SHORT_EDGE;            // landscape: height is the short edge
  return { opts, outWidth: even(w * scale), outHeight: MAX_SHORT_EDGE };
};

const sizeOf = async (uri) => {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return info?.size || 0;
  } catch {
    return 0;
  }
};

// The clip's size as it is DISPLAYED (rotation applied), read from a decoded
// frame. Falls back to whatever the picker said.
const measure = async (uri, fallbackW, fallbackH) => {
  try {
    const frame = await VideoTrim.getFrameAt(uri, { time: 0, format: 'jpeg', quality: 10, maxWidth: -1, maxHeight: -1 });
    const img = await manipulateAsync(toFileUri(frame.outputPath), [], { compress: 0.1, format: SaveFormat.JPEG });
    if (img?.width && img?.height) return { width: img.width, height: img.height };
  } catch (e) {
    console.warn('[videoProcessing] could not measure the clip — using picker size', e?.message);
  }
  return { width: fallbackW, height: fallbackH };
};

/**
 * Trim + compress a video for upload.
 *
 * @param {object}  input
 * @param {string}  input.uri            local file:// uri of the source clip
 * @param {number} [input.startSec=0]    trim window start (seconds)
 * @param {number} [input.endSec]        trim window end (seconds); omit = full
 * @param {number} [input.width]         picker's width  (a fallback only)
 * @param {number} [input.height]        picker's height (a fallback only)
 * @param {boolean}[input.thumbnail]     also extract a poster frame
 * @param {number} [input.thumbnailAtSec=0] poster frame time, in seconds from
 *                                       the start of the TRIMMED clip (the
 *                                       cover the user picked)
 * @returns {Promise<{uri, thumbnailUri, width, height, processed, compressed}>}
 *   width/height are the uploaded file's displayed size. `processed` is false
 *   when the native module was unavailable and the raw clip is returned.
 */
export const processVideo = async ({
  uri, startSec = 0, endSec, width, height, thumbnail = false, thumbnailAtSec = 0,
}) => {
  if (!isVideoProcessingAvailable()) {
    return { uri, thumbnailUri: null, width, height, processed: false, compressed: false };
  }

  // 1. Trim to the selected window (fast — native stream cut). A failure here
  //    is fatal: uploading the untrimmed clip would post something the user
  //    didn't choose.
  let workingUri = uri;
  if (endSec != null && endSec > startSec) {
    const res = await VideoTrim.trim(uri, { startTime: toMs(startSec), endTime: toMs(endSec) });
    workingUri = toFileUri(res.outputPath);
  }

  // 2. Downscale to 720p + compress to a fixed bitrate, from the MEASURED size.
  const shown = await measure(workingUri, width, height);
  const plan = planVideoScale(shown.width, shown.height);
  let finalUri = workingUri;
  let outW = shown.width;
  let outH = shown.height;
  let compressed = false;
  try {
    const res = await VideoTrim.compress(workingUri, plan.opts);
    const candidate = toFileUri(res.outputPath);
    const [before, after] = await Promise.all([sizeOf(workingUri), sizeOf(candidate)]);
    // A clip that was already lighter than 2 Mbps would come out BIGGER (and
    // re-encoded twice). Keep the re-encode only when it actually saves space.
    if (after > 0 && (!before || after < before * KEEP_IF_UNDER)) {
      finalUri = candidate;
      outW = plan.outWidth;
      outH = plan.outHeight;
      compressed = true;
    }
  } catch (e) {
    // An unusual file the encoder can't handle: the trimmed clip still posts.
    console.warn('[videoProcessing] compression failed — uploading the trimmed clip', e?.message);
  }

  // 3. Optional poster frame — the chosen cover, or the first frame.
  let thumbnailUri = null;
  if (thumbnail) {
    try {
      const frame = await VideoTrim.getFrameAt(finalUri, {
        time: toMs(thumbnailAtSec), maxWidth: THUMB_MAX_EDGE, format: 'jpeg', quality: 80,
      });
      thumbnailUri = toFileUri(frame.outputPath);
    } catch (e) {
      console.warn('[videoProcessing] thumbnail extraction failed', e?.message);
    }
  }

  return { uri: finalUri, thumbnailUri, width: outW, height: outH, processed: true, compressed };
};

/**
 * A still from `uri` at `sec` seconds, for the cover picker. Returns a local
 * jpeg uri, or null when the native module isn't in this build.
 */
export const extractFrame = async (uri, sec, maxWidth = 360) => {
  if (!VideoTrim?.getFrameAt) return null;
  const frame = await VideoTrim.getFrameAt(uri, {
    time: toMs(sec), maxWidth, format: 'jpeg', quality: 70,
  });
  return frame?.outputPath ? toFileUri(frame.outputPath) : null;
};

// Best-effort cleanup of the intermediate files this library writes to its
// scratch dir. Safe to call after a successful upload.
export const cleanupProcessedVideos = async () => {
  try {
    if (VideoTrim?.cleanFiles) await VideoTrim.cleanFiles();
  } catch (e) {
    console.warn('[videoProcessing] cleanup failed', e?.message);
  }
};
