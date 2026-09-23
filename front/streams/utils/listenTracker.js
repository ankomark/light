/**
 * How much of a track was actually heard, from the player's status ticks.
 *
 * Pure (no React/expo imports) so it's unit-testable. The player keeps one
 * `listen` object per track load and feeds it every status update; the
 * server counts a play at 30s of real listening, so seeking ahead must not
 * count as listening — only small forward steps while playing do.
 */
const COUNT_AFTER_MS = 30000;
// Status ticks arrive every ~500ms; a bigger forward jump is a seek.
const MAX_STEP_MS = 2500;

let seq = 0;
/** A per-device-unique id for one listen (the server dedupes on it). */
function newPlayId(now = Date.now(), rand = Math.random) {
  seq = (seq + 1) % 1e6;
  return `${now.toString(36)}-${seq.toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`;
}

function startListen({ trackId, source = '', positionMs = 0, durationMs = 0, now = new Date() }) {
  return {
    playId: newPlayId(now.getTime()),
    trackId,
    source,
    startedAt: now.toISOString(),
    msPlayed: 0,
    lastPos: positionMs,
    durationMs,
    reported: false,
  };
}

/**
 * Feed one status tick. Mutates `listen`; returns true exactly once, on the
 * tick that crosses the 30s mark (time to send the "it counts" report).
 */
function advance(listen, { positionMs = 0, durationMs = 0, isPlaying = false }) {
  if (!listen) return false;
  if (durationMs) listen.durationMs = durationMs;
  const step = positionMs - listen.lastPos;
  if (isPlaying && step > 0 && step <= MAX_STEP_MS) listen.msPlayed += step;
  listen.lastPos = positionMs;
  if (!listen.reported && listen.msPlayed >= COUNT_AFTER_MS) {
    listen.reported = true;
    return true;
  }
  return false;
}

/** The track played to its end: credit the last partial tick. */
function finish(listen) {
  if (!listen) return;
  const rest = listen.durationMs - listen.lastPos;
  if (rest > 0 && rest <= MAX_STEP_MS) listen.msPlayed += rest;
  listen.lastPos = listen.durationMs || listen.lastPos;
}

/** The report the server takes (POST /tracks/plays/). */
function toEvent(listen, { completed = false, ended = false, network = '' } = {}) {
  return {
    play_id: listen.playId,
    track: listen.trackId,
    ms_played: Math.round(listen.msPlayed),
    duration_ms: Math.round(listen.durationMs || 0),
    completed,
    ended,
    source: listen.source || '',
    network,
    started_at: listen.startedAt,
  };
}

/** Merge a newer report for the same listen into an older one (outbox). */
function mergeEvents(older, newer) {
  if (!older) return newer;
  return {
    ...older,
    ...newer,
    ms_played: Math.max(older.ms_played || 0, newer.ms_played || 0),
    duration_ms: newer.duration_ms || older.duration_ms || 0,
    completed: !!(older.completed || newer.completed),
    ended: !!(older.ended || newer.ended),
    started_at: older.started_at || newer.started_at,
  };
}

module.exports = {
  COUNT_AFTER_MS, MAX_STEP_MS, newPlayId, startListen, advance, finish, toEvent, mergeEvents,
};
