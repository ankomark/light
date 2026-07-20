// On-device image compression for uploads. R2 stores bytes verbatim (no ingest
// transform), so every upload path downscales + re-encodes here BEFORE upload to
// keep files small. This is the single implementation all screens share so the
// mechanism (format, error shape) stays consistent; each caller still passes its
// own target size/quality, since an avatar (256px) and a feed photo (1080px) want
// different dimensions.
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const DEFAULT_QUALITY = 0.8;

/**
 * Downscale + JPEG-compress an image.
 *
 * @param {string}  uri                  local file:// uri of the source image
 * @param {object} [opts]
 * @param {number} [opts.width]          target width; height follows the aspect
 *                                       ratio unless `height` is also given
 * @param {number} [opts.height]         target height
 * @param {number} [opts.maxWidth]       cap width WITHOUT upscaling — resizes only
 *                                       when `sourceWidth` is unknown or exceeds it
 * @param {number} [opts.sourceWidth]    source pixel width (enables the maxWidth
 *                                       no-upscale check)
 * @param {number} [opts.quality=0.8]    JPEG quality, 0..1
 * @param {boolean}[opts.base64=false]   also return the base64 payload
 * @returns {Promise<{uri, width, height, base64?}>} same shape as manipulateAsync
 */
export const compressImage = async (
  uri,
  { width, height, maxWidth, sourceWidth, quality = DEFAULT_QUALITY, base64 = false } = {}
) => {
  const resize = {};
  if (maxWidth) {
    // Cap mode: only shrink when the source is (or might be) wider than the cap,
    // so we never upscale a small image into a bigger file.
    if (!sourceWidth || sourceWidth > maxWidth) resize.width = maxWidth;
  } else {
    if (width) resize.width = width;
    if (height) resize.height = height;
  }
  const actions = resize.width || resize.height ? [{ resize }] : [];
  return manipulateAsync(uri, actions, {
    compress: quality,
    format: SaveFormat.JPEG,
    ...(base64 ? { base64: true } : {}),
  });
};
