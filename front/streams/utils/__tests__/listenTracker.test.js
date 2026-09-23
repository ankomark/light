const {
  COUNT_AFTER_MS, newPlayId, startListen, advance, finish, toEvent, mergeEvents,
} = require('../listenTracker');

const play = (listen, fromMs, toMs, step = 500) => {
  let crossed = 0;
  for (let p = fromMs; p <= toMs; p += step) {
    if (advance(listen, { positionMs: p, durationMs: 200000, isPlaying: true })) crossed += 1;
  }
  return crossed;
};

describe('listenTracker', () => {
  test('play ids are unique', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newPlayId()));
    expect(ids.size).toBe(500);
  });

  test('counts real listening and signals the 30s mark exactly once', () => {
    const l = startListen({ trackId: 7 });
    expect(play(l, 0, 29000)).toBe(0);
    expect(play(l, 29500, 40000)).toBe(1);
    expect(play(l, 40500, 60000)).toBe(0);
    expect(l.msPlayed).toBe(60000);
  });

  test('a seek forward is not listening', () => {
    const l = startListen({ trackId: 7 });
    play(l, 0, 5000);
    advance(l, { positionMs: 150000, isPlaying: true });   // dragged the seek bar
    expect(l.msPlayed).toBe(5000);
    play(l, 150500, 155000);
    expect(l.msPlayed).toBe(10000);
  });

  test('paused ticks and seeking back add nothing', () => {
    const l = startListen({ trackId: 7 });
    play(l, 0, 10000);
    advance(l, { positionMs: 10500, isPlaying: false });
    advance(l, { positionMs: 2000, isPlaying: true });
    expect(l.msPlayed).toBe(10000);
    play(l, 2500, 4000);
    expect(l.msPlayed).toBe(12000);
  });

  test('a resumed listen starts from where it resumed', () => {
    const l = startListen({ trackId: 7, positionMs: 90000 });
    advance(l, { positionMs: 90500, isPlaying: true });
    expect(l.msPlayed).toBe(500);
  });

  test('finishing credits the last partial tick', () => {
    const l = startListen({ trackId: 7 });
    play(l, 0, 199000);
    finish(l);
    expect(l.msPlayed).toBe(200000);
  });

  test('toEvent is the server shape', () => {
    const l = startListen({ trackId: 7, source: 'profile', now: new Date('2026-09-23T10:00:00Z') });
    play(l, 0, 31000);
    expect(toEvent(l, { completed: false, ended: true, network: 'wifi' })).toEqual({
      play_id: l.playId, track: 7, ms_played: 31000, duration_ms: 200000,
      completed: false, ended: true, source: 'profile', network: 'wifi',
      started_at: '2026-09-23T10:00:00.000Z',
    });
  });

  test('outbox merge keeps the most listened and never un-completes', () => {
    const a = { play_id: 'x', ms_played: COUNT_AFTER_MS, completed: true, ended: false, started_at: 't0' };
    const b = { play_id: 'x', ms_played: 1000, completed: false, ended: true, started_at: 't1' };
    expect(mergeEvents(a, b)).toMatchObject({ ms_played: COUNT_AFTER_MS, completed: true, ended: true, started_at: 't0' });
    expect(mergeEvents(null, b)).toBe(b);
  });
});
