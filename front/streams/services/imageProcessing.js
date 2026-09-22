// On-device image compression for uploads. R2 stores bytes verbatim (no ingest
// transform), so every upload path downscales + re-encodes here BEFORE upload to
// keep files small. This is the single implementation all screens share so the
// mechanism (format, error shape) stays consistent; each caller still passes its
// own target size/quality, since an avatar (256px) and a feed photo (1080px) want
// different dimensions.
//
// Two rules every caller gets for free:
//   - never upscale: a width is a CEILING. `{ width: 1080 }` on a 600px image
//     used to blow it up to 1080 — a bigger file that looked blurrier. The
//     source size is read (cheaply) when the caller didn't pass it;
//   - never make it bigger: if nothing needed resizing and the re-encode came
//     out larger than an already-JPEG source, the original is kept.
import { Image } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

const DEFAULT_QUALITY = 0.8;

/**
 * The resize to apply, or null for none. Pure, so it's unit-tested.
 *  - width and height both given: an exact box (square avatars/logos);
 *  - otherwise the width (or maxWidth) is a ceiling, applied only when the
 *    source is wider — or when its width is unknown.
 */
export const planImageResize = ({ width, height, maxWidth, sourceWidth } = {}) => {
  if (width && height && !maxWidth) return { width, height };
  const cap = maxWidth || width;
  if (cap) {
    if (!sourceWidth || sourceWidth > cap) return { width: cap };
    return null;
  }
  if (height) return { height };
  return null;
};

// The source's pixel size. Bounded by a timeout: a native call that never
// answers must not hang an upload — without a size we just resize.
const getSize = (uri, timeoutMs = 3000) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), timeoutMs);
  const done = (v) => { clearTimeout(timer); resolve(v); };
  try {
    Image.getSize(uri, (w, h) => done({ width: w, height: h }), () => done(null));
  } catch {
    done(null);
  }
});

const sizeOf = async (uri) => {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return info?.size || 0;
  } catch {
    return 0;
  }
};

const isJpeg = (uri) => /\.jpe?g(?:[?#]|$)/i.test(uri || '');

/**
 * Downscale + JPEG-compress an image.
 *
 * @param {string}  uri                  local file:// uri of the source image
 * @param {object} [opts]
 * @param {number} [opts.width]          width ceiling (never upscales); height
 *                                       follows the aspect ratio
 * @param {number} [opts.height]         with `width`: an exact box instead
 * @param {number} [opts.maxWidth]       width ceiling (same as `width` alone)
 * @param {number} [opts.sourceWidth]    source pixel width, if the caller has it
 * @param {number} [opts.quality=0.8]    JPEG quality, 0..1
 * @param {boolean}[opts.base64=false]   also return the base64 payload
 * @returns {Promise<{uri, width, height, base64?}>} same shape as manipulateAsync
 */
export const compressImage = async (
  uri,
  { width, height, maxWidth, sourceWidth, quality = DEFAULT_QUALITY, base64 = false } = {}
) => {
  let srcW = sourceWidth;
  let srcH;
  if (!srcW && (width || maxWidth) && !(width && height)) {
    const probed = await getSize(uri);
    srcW = probed?.width;
    srcH = probed?.height;
  }
  const resize = planImageResize({ width, height, maxWidth, sourceWidth: srcW });
  const out = await manipulateAsync(uri, resize ? [{ resize }] : [], {
    compress: quality,
    format: SaveFormat.JPEG,
    ...(base64 ? { base64: true } : {}),
  });

  // Nothing to shrink, and re-encoding made an already-JPEG file bigger: the
  // original is the better upload. (Not for HEIC/PNG — those must become JPEG
  // for every client to display them.)
  if (!resize && !base64 && isJpeg(uri)) {
    const [before, after] = await Promise.all([sizeOf(uri), sizeOf(out.uri)]);
    if (before > 0 && after >= before) {
      return { uri, width: srcW || out.width, height: srcH || out.height };
    }
  }
  return out;
};
