// Playback-quality resolution. R2 serves a single rendition, so these tiers are
// expressed through buffering/autoplay rather than by picking a smaller file —
// these tests pin that behaviour so the settings can't silently go inert again.
import {
  resolveVideoQuality,
  resolveAudioQuality,
  applyVideoQuality,
  applyAudioQuality,
  MEDIA_QUALITY_TIERS_AVAILABLE,
} from '../preferences';

describe('resolveVideoQuality', () => {
  it('gives the three tiers genuinely different buffering', () => {
    const saver = resolveVideoQuality('data_saver', false);
    const auto = resolveVideoQuality('auto', false);
    const hd = resolveVideoQuality('hd', false);

    const ahead = (q) => q.bufferOptions.preferredForwardBufferDuration;
    // The bug being guarded against: auto and hd behaving identically.
    expect(ahead(saver)).toBeLessThan(ahead(auto));
    expect(ahead(auto)).toBeLessThan(ahead(hd));
    expect(new Set([saver.tier, auto.tier, hd.tier]).size).toBe(3);
  });

  it('suppresses autoplay only on the data-saver tier', () => {
    expect(resolveVideoQuality('data_saver', false).autoplayAllowed).toBe(false);
    expect(resolveVideoQuality('auto', false).autoplayAllowed).toBe(true);
    expect(resolveVideoQuality('hd', false).autoplayAllowed).toBe(true);
  });

  it('lets the Data saver switch override any chosen tier', () => {
    const forced = resolveVideoQuality('hd', true);
    expect(forced.tier).toBe('data_saver');
    expect(forced.autoplayAllowed).toBe(false);
  });

  it('caps buffered bytes on the data-saver tier only', () => {
    expect(resolveVideoQuality('data_saver', false).bufferOptions.maxBufferBytes)
      .toBeGreaterThan(0);
    // 0 means "player decides" — no artificial cap.
    expect(resolveVideoQuality('hd', false).bufferOptions.maxBufferBytes).toBe(0);
  });

  it('treats an unknown/missing preference as auto', () => {
    expect(resolveVideoQuality(undefined, false).tier).toBe('auto');
    expect(resolveVideoQuality('nonsense', false).tier).toBe('auto');
  });
});

describe('resolveAudioQuality', () => {
  it('streams instead of pre-downloading under data saver', () => {
    expect(resolveAudioQuality('auto', true).downloadFirst).toBe(false);
    expect(resolveAudioQuality('data_saver', false).downloadFirst).toBe(false);
  });

  it('pre-downloads otherwise, for gap-free playback', () => {
    expect(resolveAudioQuality('auto', false).downloadFirst).toBe(true);
    expect(resolveAudioQuality('high', false).downloadFirst).toBe(true);
  });
});

describe('URL transforms', () => {
  // Documents WHY the tiers above exist: these helpers can't touch an R2 URL.
  const r2 = 'https://media.example.com/tracks/abc123.m4a';
  const cloudinary = 'https://res.cloudinary.com/demo/video/upload/v1/song.mp3';

  it('leaves R2 URLs untouched — no delivery-transform tier', () => {
    expect(applyAudioQuality(r2, 'data_saver', true)).toBe(r2);
    expect(applyVideoQuality(r2, 'hd', false)).toBe(r2);
  });

  it('still rewrites a transform-capable URL, for when renditions land', () => {
    expect(applyAudioQuality(cloudinary, 'data_saver', false)).toContain('q_auto:low');
  });

  it('never double-applies a transform', () => {
    const once = applyAudioQuality(cloudinary, 'auto', false);
    expect(applyAudioQuality(once, 'auto', false)).toBe(once);
  });

  it('advertises that rendition tiers are unavailable', () => {
    // If this flips, the audio-quality row returns in Settings — intentionally.
    expect(MEDIA_QUALITY_TIERS_AVAILABLE).toBe(false);
  });
});
