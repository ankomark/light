// Only one sound in the app plays at a time: starting any sound pauses every
// other live one, including one still loading that has been asked to play.
jest.mock('expo-audio', () => {
  const players = [];
  return {
    __players: players,
    createAudioPlayer: jest.fn(() => {
      const p = {
        playing: false,
        currentStatus: {},
        play: jest.fn(function play() { this.playing = true; }),
        pause: jest.fn(function pause() { this.playing = false; }),
        seekTo: jest.fn(async () => {}),
        remove: jest.fn(),
        addListener: jest.fn(() => ({ remove: jest.fn() })),
      };
      players.push(p);
      return p;
    }),
    setAudioModeAsync: jest.fn(async () => {}),
    requestRecordingPermissionsAsync: jest.fn(),
    RecordingPresets: { HIGH_QUALITY: { android: {}, ios: {} } },
    AudioModule: {},
  };
});

const expoAudio = require('expo-audio');
const { createSound } = require('../audioPlayer');

const players = expoAudio.__players;

beforeEach(() => { players.length = 0; });

test('starting a sound pauses the one already playing', async () => {
  const { sound: a } = await createSound({ uri: 'a' }, { shouldPlay: true });
  const { sound: b } = await createSound({ uri: 'b' }, { shouldPlay: true });
  expect(players[0].playing).toBe(false);
  expect(players[1].playing).toBe(true);

  await a.playAsync();
  expect(players[0].playing).toBe(true);
  expect(players[1].playing).toBe(false);
  await a.unloadAsync();
  await b.unloadAsync();
});

test('every way of starting takes over: play, playFromPosition, setStatus', async () => {
  const { sound: a } = await createSound({ uri: 'a' }, { shouldPlay: true });
  const { sound: b } = await createSound({ uri: 'b' });
  await b.playFromPositionAsync(1000);
  expect(players[0].playing).toBe(false);
  await a.setStatusAsync({ shouldPlay: true });
  expect(players[1].playing).toBe(false);
  expect(players[0].playing).toBe(true);
  await a.unloadAsync();
  await b.unloadAsync();
});

test('a sound still loading is paused too, so it cannot start late', async () => {
  const { sound: loading } = await createSound({ uri: 'slow' }, { shouldPlay: true });
  players[0].playing = false;              // asked to play, not sounding yet
  const { sound: now } = await createSound({ uri: 'now' }, { shouldPlay: true });
  expect(players[0].pause).toHaveBeenCalled();
  await loading.unloadAsync();
  await now.unloadAsync();
});

test('the paused sound is told, and an unloaded one is stopped and forgotten', async () => {
  const lost = jest.fn();
  const { sound: a } = await createSound({ uri: 'a' }, { shouldPlay: true });
  a.setOnFocusLost(lost);
  const { sound: b } = await createSound({ uri: 'b' }, { shouldPlay: true });
  expect(lost).toHaveBeenCalledTimes(1);

  await b.unloadAsync();
  expect(players[1].pause).toHaveBeenCalled();
  expect(players[1].remove).toHaveBeenCalled();
  await b.unloadAsync();                   // twice is harmless
  expect(players[1].remove).toHaveBeenCalledTimes(1);

  // An unloaded sound is out of the set: starting another doesn't touch it.
  players[1].pause.mockClear();
  await a.playAsync();
  expect(players[1].pause).not.toHaveBeenCalled();
  await a.unloadAsync();
});

test('silent loads (preloading the next song) do not interrupt what is playing', async () => {
  const { sound: a } = await createSound({ uri: 'a' }, { shouldPlay: true });
  const { sound: next } = await createSound({ uri: 'next' }, { shouldPlay: false });
  expect(players[0].playing).toBe(true);
  await a.unloadAsync();
  await next.unloadAsync();
});
