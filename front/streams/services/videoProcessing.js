// On-device video processing for uploads (Cloudflare R2 stores bytes verbatim,
// so trim + compression that Cloudinary used to do at ingest now happens here,
// BEFORE upload). Backed by react-native-video-trim (native AVFoundation /
// MediaCodec); requires a dev/native build — not available in Expo Go.
//
// processVideo() is the single entry point: it cuts the clip to the chosen
// window, downscales/compresses it, and (optionally) grabs a poster frame.
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

const toMs = (sec) => Math.max(0, Math.round((Number(sec) || 0) * 1000));

/**
 * Trim + compress a video for upload.
 *
 * @param {object}  input
 * @param {string}  input.uri            local file:// uri of the source clip
 * @param {number} [input.startSec=0]    trim window start (seconds)
 * @param {number} [input.endSec]        trim window end (seconds); omit = full
 * @param {number} [input.width]         source pixel width  (for downscale math)
 * @param {number} [input.height]        source pixel height
 * @param {boolean}[input.thumbnail]     also extract a poster frame
 * @returns {Promise<{uri, thumbnailUri, width, height, processed}>}
 *   `processed` is false when the native module was unavailable and the raw
 *   clip is returned untouched (so callers can still upload something).
 */
export const processVideo = async ({
  uri, startSec = 0, endSec, width, height, thumbnail = false,
}) => {
  if (!isVideoProcessingAvailable()) {
    return { uri, thumbnailUri: null, width, height, processed: false };
  }

  // 1. Trim to the selected window (fast — native stream cut).
  let workingUri = uri;
  if (endSec != null && endSec > startSec) {
    const res = await VideoTrim.trim(uri, {
      startTime: toMs(startSec),
      endTime: toMs(endSec),
    });
    workingUri = res.outputPath;
  }

  // 2. Downscale to 720p + compress to a fixed bitrate. We cap the SHORT edge:
  //    the library derives the other side from the aspect ratio (scale=w:-2), so
  //    a portrait clip becomes 720x1280 (crisp) and a landscape one 1280x720. The
  //    bitrate is the real file-size lever; the resolution cap just keeps quality
  //    high per bit. We only ever scale DOWN — a source already ≤720 on its short
  //    edge keeps its native size. With unknown dimensions we skip the resize
  //    (avoids upscaling a small clip) and let the bitrate cap do the shrinking.
  const shortEdge = Math.min(width || 0, height || 0);
  const compressOpts = { bitrate: TARGET_BITRATE_BPS };
  if (shortEdge > MAX_SHORT_EDGE) {
    if (height >= width) {
      compressOpts.width = MAX_SHORT_EDGE;  // portrait: the short edge is width
    } else {
      compressOpts.height = MAX_SHORT_EDGE; // landscape: the short edge is height
    }
  }
  const compressed = await VideoTrim.compress(workingUri, compressOpts);
  const finalUri = compressed.outputPath;

  // 3. Optional poster frame (first frame of the trimmed clip).
  let thumbnailUri = null;
  if (thumbnail) {
    try {
      const frame = await VideoTrim.getFrameAt(finalUri, {
        time: 0, maxWidth: THUMB_MAX_EDGE, format: 'jpeg', quality: 80,
      });
      thumbnailUri = frame.outputPath;
    } catch (e) {
      console.warn('[videoProcessing] thumbnail extraction failed', e?.message);
    }
  }

  // Downscaled dimensions aren't reported back by compress(); leave the source
  // values so the feed's aspect-ratio math still holds (ratio is unchanged).
  return { uri: finalUri, thumbnailUri, width, height, processed: true };
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
