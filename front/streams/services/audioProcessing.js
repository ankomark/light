// On-device audio transcoding for uploads. Cloudflare R2 stores bytes verbatim,
// so shrinking files BEFORE upload directly cuts storage + egress cost. We
// re-encode to ~128 kbps AAC/m4a — near-transparent for music — and only keep the
// result when it's actually smaller, so an already-low-bitrate file is never
// degraded or made larger. Backed by react-native-compressor (native); requires a
// dev/native build (not available in Expo Go), and degrades to a no-op otherwise.
import * as FileSystem from 'expo-file-system/legacy';

let Audio = null;
try {
  // Lazy require so a build without the native module doesn't crash at import;
  // compressAudio() then returns the original file untouched.
  Audio = require('react-native-compressor').Audio;
} catch (e) {
  console.warn('[audioProcessing] native module unavailable — upload will use the raw file.', e?.message);
}

export const isAudioCompressionAvailable = () => !!(Audio && Audio.compress);

// 128 kbps AAC: transparent-enough for music while cutting a high-bitrate source
// (256–320 kbps) by ~50–70%. Raise toward 160k for more headroom, lower toward
// 96k for smaller files.
export const TARGET_BITRATE_BPS = 128000;

// Don't bother transcoding tiny files — the savings are negligible and a small
// source is likely already low-bitrate (re-encoding would just degrade it).
const MIN_COMPRESS_BYTES = 1.5 * 1024 * 1024; // 1.5 MB

// Only adopt the transcode when it saved a meaningful amount; otherwise the
// source was already efficient and we keep the crisp original.
const KEEP_IF_UNDER = 0.95;

const sizeOf = async (uri) => {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return info?.size || 0;
  } catch {
    return 0;
  }
};

/**
 * Transcode an audio file to ~128 kbps AAC for upload.
 *
 * @param {object}  input
 * @param {string}  input.uri                local file:// uri of the source audio
 * @param {number} [input.bitrate]           target bitrate (bps); default 128k
 * @returns {Promise<{uri, compressed, originalSize, finalSize, savedPct}>}
 *   `compressed` is false (and `uri` is the original) when the native module is
 *   missing, the file is already small, or the re-encode didn't save space.
 */
export const compressAudio = async ({ uri, bitrate = TARGET_BITRATE_BPS } = {}) => {
  const originalSize = await sizeOf(uri);
  const asIs = { uri, compressed: false, originalSize, finalSize: originalSize, savedPct: 0 };

  if (!uri || !isAudioCompressionAvailable()) return asIs;
  if (originalSize && originalSize < MIN_COMPRESS_BYTES) return asIs;

  try {
    const outUri = await Audio.compress(uri, { quality: 'medium', bitrate });
    const finalSize = await sizeOf(outUri);
    if (finalSize > 0 && originalSize > 0 && finalSize < originalSize * KEEP_IF_UNDER) {
      return {
        uri: outUri,
        compressed: true,
        originalSize,
        finalSize,
        savedPct: Math.round((1 - finalSize / originalSize) * 100),
      };
    }
    return asIs; // source was already efficient — keep the original
  } catch (e) {
    console.warn('[audioProcessing] compression failed — using original.', e?.message);
    return asIs;
  }
};
