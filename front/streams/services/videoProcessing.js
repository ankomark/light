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

// Long edge cap for stored video. 1080 keeps feed/story clips crisp on phones
// while cutting file size hard vs. a 4K original.
const MAX_LONG_EDGE = 1080;

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

  // 2. Downscale + compress. Cap the LONG edge to MAX_LONG_EDGE; the library
  //    auto-derives the other side from the aspect ratio, so this works for
  //    portrait and landscape. When we don't know the source size, cap width
  //    and let height follow.
  const longEdge = Math.max(width || 0, height || 0);
  const needsDownscale = longEdge === 0 || longEdge > MAX_LONG_EDGE;
  const compressOpts = { quality: 'medium' }; // CRF 23 — balanced
  if (needsDownscale) {
    if (width && height && height > width) {
      compressOpts.height = MAX_LONG_EDGE; // portrait: cap height
    } else {
      compressOpts.width = MAX_LONG_EDGE;  // landscape/unknown: cap width
    }
  }
  const compressed = await VideoTrim.compress(workingUri, compressOpts);
  const finalUri = compressed.outputPath;

  // 3. Optional poster frame (first frame of the trimmed clip).
  let thumbnailUri = null;
  if (thumbnail) {
    try {
      const frame = await VideoTrim.getFrameAt(finalUri, {
        time: 0, maxWidth: MAX_LONG_EDGE, format: 'jpeg', quality: 80,
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
