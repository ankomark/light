/**
 * The slice of a track the player's queue keeps: enough to play it, show it
 * (mini player, Now Playing, lock screen) and save it with the session — not
 * the lyrics, which Now Playing fetches for the song actually playing, so a
 * queue is a list of pointers rather than a pile of text.
 */
export default function toQueueTrack(t) {
  return {
    id: t.id,
    title: t.title,
    album: t.album,
    artist: t.artist,
    cover_image: t.cover_image,
    audio_file: t.audio_file,
    has_lyrics: t.has_lyrics,
    duration_ms: t.duration_ms ?? null,
  };
}
