const { pickAudioSource } = require('../audioQuality');

const processed = {
  audio_file: 'orig.mp3',
  audio_low: '64.m4a',
  audio_standard: '128.m4a',
  audio_high: '256.m4a',
};
const original = { audio_file: 'orig.mp3' };

const pick = (track, opts) => pickAudioSource(track, opts).uri;

describe('pickAudioSource', () => {
  test('Automatic: high on Wi-Fi, standard on mobile data or unknown', () => {
    expect(pick(processed, { audioQuality: 'auto', network: 'wifi' })).toBe('256.m4a');
    expect(pick(processed, { audioQuality: 'auto', network: 'cellular' })).toBe('128.m4a');
    expect(pick(processed, { audioQuality: 'auto', network: '' })).toBe('128.m4a');
  });

  test('fixed choices ignore the connection', () => {
    expect(pick(processed, { audioQuality: 'high', network: 'cellular' })).toBe('256.m4a');
    expect(pick(processed, { audioQuality: 'standard', network: 'wifi' })).toBe('128.m4a');
    expect(pick(processed, { audioQuality: 'data_saver', network: 'wifi' })).toBe('64.m4a');
  });

  test('the Data saver switch wins over any choice', () => {
    expect(pick(processed, { audioQuality: 'high', dataSaver: true, network: 'wifi' })).toBe('64.m4a');
  });

  test('processed versions stream; they are never downloaded first', () => {
    expect(pickAudioSource(processed, { audioQuality: 'high' })).toEqual({ uri: '256.m4a', tier: 'audio_high', downloadFirst: false });
  });

  test('an unprocessed song plays its original, as before', () => {
    expect(pickAudioSource(original, { audioQuality: 'auto', network: 'wifi' }))
      .toEqual({ uri: 'orig.mp3', tier: 'original', downloadFirst: true });
    expect(pickAudioSource(original, { dataSaver: true }).downloadFirst).toBe(false);
  });

  test('a missing version falls back to the nearest one, smaller first when saving data', () => {
    expect(pick({ ...processed, audio_low: null }, { dataSaver: true })).toBe('128.m4a');
    expect(pick({ ...processed, audio_high: '' }, { audioQuality: 'high' })).toBe('128.m4a');
    expect(pick({ ...processed, audio_standard: null }, { audioQuality: 'standard' })).toBe('64.m4a');
  });

  test('nothing to play', () => {
    expect(pickAudioSource(null).uri).toBeNull();
    expect(pickAudioSource({}).uri).toBeNull();
  });
});
