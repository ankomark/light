/**
 * Which version of a song to stream, from the quality setting and the
 * connection. Pure, so it's unit-testable.
 *
 * Processed songs have three loudness-matched AAC versions (see the backend's
 * songs/audio_processing.py): audio_low (64 kbps), audio_standard (128) and
 * audio_high (256). Until a song is processed it has only its original upload,
 * `audio_file`, which is what plays.
 *
 *   Automatic   — High on Wi-Fi, Standard on mobile data
 *   High        — High everywhere
 *   Standard    — Standard everywhere
 *   Data saver  — Low everywhere (also forced by the Data saver switch)
 */
const ORDER = ['audio_low', 'audio_standard', 'audio_high'];

const wantedTier = (audioQuality, dataSaver, network) => {
  if (dataSaver || audioQuality === 'data_saver') return 'audio_low';
  if (audioQuality === 'high') return 'audio_high';
  if (audioQuality === 'standard') return 'audio_standard';
  return network === 'wifi' ? 'audio_high' : 'audio_standard';
};

/**
 * { uri, tier, downloadFirst } for streaming `track`.
 *
 * `downloadFirst` (pull the whole file before playing) only for an original
 * upload off Data saver: a processed version is a "faststart" .m4a that plays
 * as it streams, so waiting for all of it would only delay the start.
 */
function pickAudioSource(track, { audioQuality = 'auto', dataSaver = false, network = '' } = {}) {
  if (!track) return { uri: null, tier: null, downloadFirst: false };
  const want = wantedTier(audioQuality, dataSaver, network);
  if (track[want]) return { uri: track[want], tier: want, downloadFirst: false };
  // Missing just that one (shouldn't happen): the nearest other version,
  // smaller first when saving data.
  const i = ORDER.indexOf(want);
  const near = want === 'audio_low'
    ? [ORDER[1], ORDER[2]]
    : [ORDER[i - 1], ORDER[i + 1]].filter(Boolean);
  for (const tier of near) {
    if (track[tier]) return { uri: track[tier], tier, downloadFirst: false };
  }
  const low = dataSaver || audioQuality === 'data_saver';
  return { uri: track.audio_file || null, tier: 'original', downloadFirst: !low };
}

/** Qualities offered for offline downloads, and the server's name for each. */
const DOWNLOAD_QUALITIES = ['standard', 'high'];

module.exports = { pickAudioSource, wantedTier, DOWNLOAD_QUALITIES };
